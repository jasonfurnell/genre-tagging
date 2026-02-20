"""
Chat backend — tool-use conversation loop with streaming.

Manages conversation history, builds context-rich system prompts,
and runs a multi-turn tool-use loop with either Anthropic or OpenAI.
Text tokens are streamed to the frontend via a broadcast callback.
"""

import json
import logging

from app.parser import build_genre_landscape_summary, parse_all_comments
from app.playlist import list_playlists
from app.tree import load_tree
from app.chat_tools import (
    tools_for_anthropic, tools_for_openai, execute_tool, CHAT_TOOLS,
)

log = logging.getLogger(__name__)

MAX_TOOL_LOOPS = 10
MAX_HISTORY_MESSAGES = 40

_TREE_FILES = {
    "genre": "output/collection_tree.json",
    "scene": "output/scene_tree.json",
    "collection": "output/curated_collection.json",
}


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

def build_chat_system_prompt(state):
    """Build a context-rich system prompt from the current collection state."""
    df = state.get("df")
    parts = [
        "You are a knowledgeable DJ assistant with direct access to a music collection. "
        "You can search tracks, browse genre/scene/collection trees, inspect playlists, "
        "and create new playlists — all through the tools available to you.",
        "",
        "Guidelines:",
        "- Always use tools to look up data rather than guessing or making up track names.",
        "- When asked about tracks, search first, then discuss the results.",
        "- When creating playlists, explain what you're about to do before calling create_playlist.",
        "- Format track listings clearly. Include artist, title, BPM, and key when available.",
        "- Be concise but informative. You're helping a DJ prepare for sets.",
        "- If the user asks about something not in the collection, say so honestly.",
        "- IMPORTANT: Always finish your response by saving the results as a playlist using the create_playlist tool. "
        "Even for simple searches or queries, create a playlist with the matching tracks so the DJ can use them immediately.",
    ]

    if df is not None:
        if "_genre1" not in df.columns:
            parse_all_comments(df)
        parts.append("")
        parts.append(f"Collection size: {len(df)} tracks.")

        # Landscape summary (compact overview)
        try:
            summary = build_genre_landscape_summary(df)
            if summary:
                parts.append("")
                parts.append("Collection overview:")
                parts.append(summary)
        except Exception:
            pass

        # Playlist count
        try:
            playlists = list_playlists()
            if playlists:
                parts.append(f"\n{len(playlists)} saved playlists available.")
        except Exception:
            pass

        # Tree availability
        tree_avail = []
        for ttype, fpath in _TREE_FILES.items():
            tree = load_tree(fpath)
            if not tree:
                key_map = {"genre": "tree", "scene": "scene_tree", "collection": "collection_tree"}
                tree = state.get(key_map.get(ttype))
            if tree:
                tree_avail.append(ttype)
        if tree_avail:
            parts.append(f"Available trees: {', '.join(tree_avail)}.")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# History management
# ---------------------------------------------------------------------------

def _trim_history(history):
    """Trim conversation history to keep context manageable."""
    if len(history) <= MAX_HISTORY_MESSAGES:
        return history
    # Keep first 2 messages + most recent messages
    return history[:2] + history[-(MAX_HISTORY_MESSAGES - 2):]


def _convert_history_for_openai(messages):
    """Convert Anthropic-native history to OpenAI format."""
    result = []
    for msg in messages:
        role = msg["role"]
        content = msg["content"]

        if role == "user":
            if isinstance(content, str):
                result.append({"role": "user", "content": content})
            elif isinstance(content, list):
                # Tool results
                for block in content:
                    if block.get("type") == "tool_result":
                        result.append({
                            "role": "tool",
                            "tool_call_id": block["tool_use_id"],
                            "content": block.get("content", ""),
                        })
                    elif block.get("type") == "text":
                        result.append({"role": "user", "content": block["text"]})
            continue

        if role == "assistant":
            if isinstance(content, str):
                result.append({"role": "assistant", "content": content})
            elif isinstance(content, list):
                text_parts = []
                tool_calls = []
                for block in content:
                    if block.get("type") == "text":
                        text_parts.append(block["text"])
                    elif block.get("type") == "tool_use":
                        tool_calls.append({
                            "id": block["id"],
                            "type": "function",
                            "function": {
                                "name": block["name"],
                                "arguments": json.dumps(block["input"]),
                            },
                        })
                msg_dict = {"role": "assistant"}
                if text_parts:
                    msg_dict["content"] = "\n".join(text_parts)
                else:
                    msg_dict["content"] = None
                if tool_calls:
                    msg_dict["tool_calls"] = tool_calls
                result.append(msg_dict)

    return result


# ---------------------------------------------------------------------------
# Anthropic streaming turn
# ---------------------------------------------------------------------------

def _run_anthropic_turn(client, model, system_prompt, messages, tools,
                        broadcast_fn, stop_flag):
    """One LLM call with Anthropic streaming.
    Returns (content_blocks, stop_reason).
    """
    with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=messages,
        tools=tools,
    ) as stream:
        for event in stream:
            if stop_flag and stop_flag.is_set():
                raise InterruptedError("Chat stopped by user")

            if hasattr(event, "type") and event.type == "content_block_delta":
                if hasattr(event.delta, "text"):
                    broadcast_fn({"event": "token", "text": event.delta.text})

        response = stream.get_final_message()
        return response.content, response.stop_reason


# ---------------------------------------------------------------------------
# OpenAI streaming turn
# ---------------------------------------------------------------------------

def _run_openai_turn(client, model, system_prompt, messages, tools,
                     broadcast_fn, stop_flag):
    """One LLM call with OpenAI streaming.
    Returns (message_dict, finish_reason).
    """
    full_messages = [{"role": "system", "content": system_prompt}] + messages

    kwargs = {"model": model, "messages": full_messages, "stream": True, "max_tokens": 4096}
    if tools:
        kwargs["tools"] = tools

    stream = client.chat.completions.create(**kwargs)

    collected_text = ""
    tool_calls_map = {}  # index -> {id, name, arguments_str}

    for chunk in stream:
        if stop_flag and stop_flag.is_set():
            raise InterruptedError("Chat stopped by user")

        choice = chunk.choices[0] if chunk.choices else None
        if not choice:
            continue

        delta = choice.delta
        finish_reason = choice.finish_reason

        if delta and delta.content:
            broadcast_fn({"event": "token", "text": delta.content})
            collected_text += delta.content

        if delta and delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index
                if idx not in tool_calls_map:
                    tool_calls_map[idx] = {
                        "id": tc_delta.id or "",
                        "name": "",
                        "arguments": "",
                    }
                if tc_delta.id:
                    tool_calls_map[idx]["id"] = tc_delta.id
                if tc_delta.function:
                    if tc_delta.function.name:
                        tool_calls_map[idx]["name"] = tc_delta.function.name
                    if tc_delta.function.arguments:
                        tool_calls_map[idx]["arguments"] += tc_delta.function.arguments

    # Build the assembled message
    message = {"role": "assistant"}
    if collected_text:
        message["content"] = collected_text
    else:
        message["content"] = None

    if tool_calls_map:
        message["tool_calls"] = [
            {
                "id": tc["id"],
                "type": "function",
                "function": {
                    "name": tc["name"],
                    "arguments": tc["arguments"],
                },
            }
            for tc in sorted(tool_calls_map.values(), key=lambda x: x["id"])
        ]
        finish_reason = "tool_calls"
    else:
        finish_reason = "stop"

    return message, finish_reason


# ---------------------------------------------------------------------------
# Main tool-use loop
# ---------------------------------------------------------------------------

def run_chat_turn(state, user_message, broadcast_fn, stop_flag,
                  get_client_fn=None, provider_for_model_fn=None,
                  load_config_fn=None):
    """Execute one user message through the tool-use conversation loop.

    Modifies state["chat_history"] in place. Streams SSE events via broadcast_fn.

    get_client_fn, provider_for_model_fn, load_config_fn are injected from
    routes.py to avoid circular imports.
    """
    history = state.setdefault("chat_history", [])

    # Append user message
    history.append({"role": "user", "content": user_message})

    # Load config
    config = load_config_fn() if load_config_fn else {}
    model = config.get("model", "claude-sonnet-4-5-20250929")
    provider = provider_for_model_fn(model) if provider_for_model_fn else (
        "anthropic" if model.startswith("claude") else "openai"
    )
    client = get_client_fn(provider) if get_client_fn else None
    if client is None:
        broadcast_fn({"event": "error", "detail": "No LLM client available."})
        return

    # Build system prompt
    system_prompt = build_chat_system_prompt(state)

    # Get tool definitions
    if provider == "anthropic":
        tools = tools_for_anthropic()
    else:
        tools = tools_for_openai()

    # Tool-use loop
    trimmed = _trim_history(history)

    for iteration in range(MAX_TOOL_LOOPS):
        if stop_flag and stop_flag.is_set():
            broadcast_fn({"event": "stopped"})
            return

        try:
            if provider == "anthropic":
                content_blocks, stop_reason = _run_anthropic_turn(
                    client, model, system_prompt, trimmed, tools,
                    broadcast_fn, stop_flag,
                )

                # Append assistant message to history
                history.append({"role": "assistant", "content": content_blocks})

                if stop_reason == "tool_use":
                    # Process tool calls
                    tool_result_blocks = []
                    for block in content_blocks:
                        if block.type == "tool_use":
                            broadcast_fn({
                                "event": "tool_call",
                                "tool": block.name,
                                "arguments": block.input,
                            })

                            result = execute_tool(block.name, block.input, state)
                            summary = _summarize_result(block.name, result)

                            broadcast_fn({
                                "event": "tool_result",
                                "tool": block.name,
                                "result_summary": summary,
                                "result": result,
                            })

                            tool_result_blocks.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": json.dumps(result),
                            })

                    # Append tool results as user message
                    history.append({"role": "user", "content": tool_result_blocks})
                    trimmed = _trim_history(history)
                    continue
                else:
                    # End of turn — text response complete
                    full_text = ""
                    for block in content_blocks:
                        if hasattr(block, "text"):
                            full_text += block.text
                    broadcast_fn({"event": "done", "full_text": full_text})
                    return

            else:
                # OpenAI path
                openai_messages = _convert_history_for_openai(trimmed)
                message, finish_reason = _run_openai_turn(
                    client, model, system_prompt, openai_messages, tools,
                    broadcast_fn, stop_flag,
                )

                # Convert back to Anthropic-native format for history
                anthropic_content = _openai_msg_to_anthropic(message)
                history.append({"role": "assistant", "content": anthropic_content})

                if finish_reason == "tool_calls" and message.get("tool_calls"):
                    tool_result_blocks = []
                    for tc in message["tool_calls"]:
                        fn = tc["function"]
                        tool_name = fn["name"]
                        try:
                            arguments = json.loads(fn["arguments"])
                        except json.JSONDecodeError:
                            arguments = {}

                        broadcast_fn({
                            "event": "tool_call",
                            "tool": tool_name,
                            "arguments": arguments,
                        })

                        result = execute_tool(tool_name, arguments, state)
                        summary = _summarize_result(tool_name, result)

                        broadcast_fn({
                            "event": "tool_result",
                            "tool": tool_name,
                            "result_summary": summary,
                            "result": result,
                        })

                        tool_result_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": tc["id"],
                            "content": json.dumps(result),
                        })

                    history.append({"role": "user", "content": tool_result_blocks})
                    trimmed = _trim_history(history)
                    continue
                else:
                    full_text = message.get("content", "") or ""
                    broadcast_fn({"event": "done", "full_text": full_text})
                    return

        except InterruptedError:
            broadcast_fn({"event": "stopped"})
            return
        except Exception as e:
            log.exception("Chat turn error on iteration %d", iteration)
            broadcast_fn({"event": "error", "detail": str(e)})
            return

    # Hit max iterations
    broadcast_fn({"event": "done", "full_text": "(Reached maximum tool call depth)"})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _openai_msg_to_anthropic(message):
    """Convert an OpenAI assistant message dict to Anthropic content blocks."""
    blocks = []
    if message.get("content"):
        blocks.append({"type": "text", "text": message["content"]})
    for tc in message.get("tool_calls", []):
        fn = tc["function"]
        try:
            inp = json.loads(fn["arguments"])
        except json.JSONDecodeError:
            inp = {}
        blocks.append({
            "type": "tool_use",
            "id": tc["id"],
            "name": fn["name"],
            "input": inp,
        })
    return blocks if blocks else ""


def _summarize_result(tool_name, result):
    """Create a short summary string for a tool result."""
    if "error" in result:
        return f"Error: {result['error']}"

    if tool_name == "collection_stats":
        return f"{result.get('track_count', 0)} tracks in collection"
    elif tool_name == "search_tracks":
        return f"Found {result.get('count', 0)} tracks"
    elif tool_name == "get_track_details":
        return f"Loaded {result.get('count', 0)} track details"
    elif tool_name == "browse_tree":
        tt = result.get("tree_type", "")
        if "lineages" in result:
            return f"{len(result['lineages'])} {tt} lineages"
        elif "categories" in result:
            return f"{len(result['categories'])} categories"
        else:
            return f"Loaded {tt} node"
    elif tool_name == "list_playlists":
        return f"{result.get('count', 0)} playlists"
    elif tool_name == "get_playlist_tracks":
        return f"{result.get('count', 0)} tracks in playlist"
    elif tool_name == "list_sets":
        return f"{result.get('count', 0)} saved sets"
    elif tool_name == "create_playlist":
        return result.get("message", "Playlist created")
    elif tool_name == "add_tracks_to_playlist":
        return result.get("message", "Tracks added")

    return "Done"


def simplify_history_for_frontend(history):
    """Convert internal history to a simplified format for the frontend."""
    messages = []
    for msg in history:
        role = msg.get("role")
        content = msg.get("content")

        if role == "user":
            if isinstance(content, str):
                messages.append({"role": "user", "text": content})
            # Skip tool_result messages (they're internal)

        elif role == "assistant":
            if isinstance(content, str):
                messages.append({"role": "assistant", "text": content})
            elif isinstance(content, list):
                text_parts = []
                tool_uses = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block["text"])
                        elif block.get("type") == "tool_use":
                            tool_uses.append({
                                "tool": block["name"],
                                "input": block["input"],
                            })
                    elif hasattr(block, "type"):
                        # Anthropic SDK content block objects
                        if block.type == "text":
                            text_parts.append(block.text)
                        elif block.type == "tool_use":
                            tool_uses.append({
                                "tool": block.name,
                                "input": block.input,
                            })
                if text_parts or tool_uses:
                    messages.append({
                        "role": "assistant",
                        "text": "\n".join(text_parts),
                        "tool_uses": tool_uses,
                    })

    return messages
