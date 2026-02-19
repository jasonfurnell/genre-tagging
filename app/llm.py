"""Async LLM client with provider auto-detection and retry.

Replaces duplicated provider routing in tagger.py, tree.py, playlist.py,
autoset.py, and chat.py. Supports both OpenAI and Anthropic SDKs.

Usage::

    llm = LLMClient()  # reads API keys from env

    # Simple text response
    text = await llm.call("Describe this track...", model="claude-sonnet-4-5-20250929")

    # JSON response (parsed + validated)
    data = await llm.call_json("Return JSON...", model="gpt-4o")

    # Streaming text (for chat)
    async for token in llm.stream("Hello!", model="claude-sonnet-4-5-20250929"):
        print(token, end="")

    # Streaming with tool use (for chat)
    async for event in llm.stream_with_tools(...):
        ...
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from openai import AsyncOpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

load_dotenv()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Model tiering (replaces tree.py COLLECTION_TREE_MODELS + _get_tiered_model)
# ---------------------------------------------------------------------------

DEFAULT_TIERED_MODELS: dict[str, str] = {
    "creative": "claude-sonnet-4-5-20250929",
    "mechanical": "claude-3-5-haiku-20241022",
}


def provider_for_model(model: str) -> str:
    """Detect provider from model name."""
    return "anthropic" if model.startswith("claude") else "openai"


def get_tiered_model(
    tier: str, config: dict[str, str] | None = None
) -> tuple[str, str]:
    """Return (model_name, provider) for a tier ('creative' or 'mechanical')."""
    models = config or DEFAULT_TIERED_MODELS
    model = models.get(tier, models.get("creative", "claude-sonnet-4-5-20250929"))
    return model, provider_for_model(model)


# ---------------------------------------------------------------------------
# JSON extraction (replaces tree.py _extract_json)
# ---------------------------------------------------------------------------

def extract_json(text: str) -> Any:
    """Extract and parse JSON from LLM response text.

    Handles:
    - Pure JSON responses
    - JSON wrapped in ```json ... ``` code blocks
    - JSON embedded in surrounding text
    """
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from code block
    m = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { or [ and matching to end
    for opener, closer in [("{", "}"), ("[", "]")]:
        start = text.find(opener)
        if start == -1:
            continue
        end = text.rfind(closer)
        if end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue

    raise ValueError(f"Could not extract JSON from LLM response: {text[:200]}...")


# ---------------------------------------------------------------------------
# Streaming event types
# ---------------------------------------------------------------------------

@dataclass
class TokenEvent:
    """A text token from a streaming response."""
    text: str


@dataclass
class ToolCallEvent:
    """LLM wants to call a tool."""
    id: str
    name: str
    arguments: dict


@dataclass
class DoneEvent:
    """Stream completed."""
    content: list  # Anthropic content blocks or OpenAI message
    stop_reason: str


StreamEvent = TokenEvent | ToolCallEvent | DoneEvent


# ---------------------------------------------------------------------------
# LLMClient
# ---------------------------------------------------------------------------

class LLMClient:
    """Async LLM client supporting OpenAI and Anthropic.

    Provider is auto-detected from model name (claude* → Anthropic, else OpenAI).
    """

    def __init__(
        self,
        openai_api_key: str | None = None,
        anthropic_api_key: str | None = None,
    ) -> None:
        self._openai: AsyncOpenAI | None = None
        self._anthropic: AsyncAnthropic | None = None
        self._openai_key = openai_api_key or os.getenv("OPENAI_API_KEY")
        self._anthropic_key = anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")

    def _get_openai(self) -> AsyncOpenAI:
        if self._openai is None:
            self._openai = AsyncOpenAI(api_key=self._openai_key)
        return self._openai

    def _get_anthropic(self) -> AsyncAnthropic:
        if self._anthropic is None:
            self._anthropic = AsyncAnthropic(api_key=self._anthropic_key)
        return self._anthropic

    # ----- Non-streaming text call -----

    @retry(
        wait=wait_exponential(multiplier=1, min=3, max=30),
        stop=stop_after_attempt(3),
        retry=retry_if_exception_type(Exception),
    )
    async def call(
        self,
        user_prompt: str,
        *,
        model: str,
        system_prompt: str = "",
        max_tokens: int = 4096,
    ) -> str:
        """Make a non-streaming LLM call and return the text response."""
        provider = provider_for_model(model)

        if provider == "anthropic":
            client = self._get_anthropic()
            kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": user_prompt.strip()}],
            }
            if system_prompt:
                kwargs["system"] = system_prompt
            response = await client.messages.create(**kwargs)
            return response.content[0].text.strip()
        else:
            client = self._get_openai()
            messages: list[dict] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": user_prompt.strip()})
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
            )
            return (response.choices[0].message.content or "").strip()

    # ----- Non-streaming JSON call -----

    async def call_json(
        self,
        user_prompt: str,
        *,
        model: str,
        system_prompt: str = "",
        max_tokens: int = 4096,
    ) -> Any:
        """Make a non-streaming LLM call and parse the response as JSON."""
        text = await self.call(
            user_prompt,
            model=model,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
        )
        return extract_json(text)

    # ----- Streaming text -----

    async def stream(
        self,
        user_prompt: str,
        *,
        model: str,
        system_prompt: str = "",
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        """Stream text tokens from the LLM."""
        provider = provider_for_model(model)

        if provider == "anthropic":
            client = self._get_anthropic()
            kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": user_prompt.strip()}],
            }
            if system_prompt:
                kwargs["system"] = system_prompt
            async with client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    yield text
        else:
            client = self._get_openai()
            messages: list[dict] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": user_prompt.strip()})
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

    # ----- Streaming with tool use (chat) -----

    async def stream_with_tools(
        self,
        messages: list[dict],
        *,
        model: str,
        system_prompt: str = "",
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream tokens and tool calls from a multi-turn conversation.

        Args:
            messages: Conversation history in Anthropic-native format.
            model: Model name (auto-detects provider).
            system_prompt: System message.
            tools: Tool definitions (canonical JSON Schema format).
            max_tokens: Max response tokens.

        Yields:
            TokenEvent for text chunks, ToolCallEvent for tool invocations,
            DoneEvent when the turn is complete.
        """
        provider = provider_for_model(model)

        if provider == "anthropic":
            async for event in self._stream_anthropic_tools(
                messages, model=model, system_prompt=system_prompt,
                tools=tools, max_tokens=max_tokens,
            ):
                yield event
        else:
            async for event in self._stream_openai_tools(
                messages, model=model, system_prompt=system_prompt,
                tools=tools, max_tokens=max_tokens,
            ):
                yield event

    async def _stream_anthropic_tools(
        self,
        messages: list[dict],
        *,
        model: str,
        system_prompt: str,
        tools: list[dict] | None,
        max_tokens: int,
    ) -> AsyncGenerator[StreamEvent, None]:
        client = self._get_anthropic()
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            # Anthropic tool format: {name, description, input_schema}
            kwargs["tools"] = [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "input_schema": t["parameters"],
                }
                for t in tools
            ]

        async with client.messages.stream(**kwargs) as stream:
            async for event in stream:
                if hasattr(event, "type") and event.type == "content_block_delta":
                    if hasattr(event.delta, "text"):
                        yield TokenEvent(text=event.delta.text)

            response = await stream.get_final_message()

        # Emit tool calls and done
        for block in response.content:
            if block.type == "tool_use":
                yield ToolCallEvent(
                    id=block.id,
                    name=block.name,
                    arguments=block.input if isinstance(block.input, dict) else {},
                )

        yield DoneEvent(content=response.content, stop_reason=response.stop_reason)

    async def _stream_openai_tools(
        self,
        messages: list[dict],
        *,
        model: str,
        system_prompt: str,
        tools: list[dict] | None,
        max_tokens: int,
    ) -> AsyncGenerator[StreamEvent, None]:
        client = self._get_openai()

        # Convert to OpenAI message format
        oai_messages: list[dict] = []
        if system_prompt:
            oai_messages.append({"role": "system", "content": system_prompt})
        oai_messages.extend(messages)

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": oai_messages,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if tools:
            # OpenAI tool format: {type: "function", function: {name, description, parameters}}
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t["parameters"],
                    },
                }
                for t in tools
            ]

        stream = await client.chat.completions.create(**kwargs)

        collected_text = ""
        tool_calls_map: dict[int, dict] = {}
        finish_reason = "stop"

        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue

            delta = choice.delta
            if choice.finish_reason:
                finish_reason = choice.finish_reason

            if delta and delta.content:
                yield TokenEvent(text=delta.content)
                collected_text += delta.content

            if delta and delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_map:
                        tool_calls_map[idx] = {"id": "", "name": "", "arguments": ""}
                    if tc.id:
                        tool_calls_map[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            tool_calls_map[idx]["name"] = tc.function.name
                        if tc.function.arguments:
                            tool_calls_map[idx]["arguments"] += tc.function.arguments

        # Emit tool calls
        for _idx, tc in sorted(tool_calls_map.items()):
            try:
                args = json.loads(tc["arguments"]) if tc["arguments"] else {}
            except json.JSONDecodeError:
                args = {}
            yield ToolCallEvent(id=tc["id"], name=tc["name"], arguments=args)

        # Build content for DoneEvent
        content = {"role": "assistant", "content": collected_text or None}
        if tool_calls_map:
            content["tool_calls"] = [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                }
                for _idx, tc in sorted(tool_calls_map.items())
            ]

        yield DoneEvent(content=[content], stop_reason=finish_reason)
