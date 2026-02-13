import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")

DEFAULT_SYSTEM_PROMPT = "You are a music genre expert and DJ selector."

DEFAULT_USER_PROMPT_TEMPLATE = (
 'Describe this track for DJs in one concise sentence (15–25 words). '
    'Do not repeat the main genre name in the description fields. '
    'Use vivid, club-friendly phrasing.\n'
    'Format: Main genre; Sub genre; production traits; scene/mood/country; area of origin, era info.\n'
    'Example: New Wave; Synth-pop; seductive synth, driving drum patterns, catchy guitar riffs; boundary-pushing 80s glam rock scene; UK, early 80s. '
    'late-night Ibiza terrace, mid-2010s.\n\n'
    'Track title: "{title}"\n'
    'Artist: {artist}\n'
    'BPM: {bpm}\n'
    'Key: {key}\n'
    'Year: {year}'
)

DEFAULT_CONFIG = {
    "model": "claude-sonnet-4-5-20250929",
    "system_prompt": DEFAULT_SYSTEM_PROMPT,
    "user_prompt_template": DEFAULT_USER_PROMPT_TEMPLATE,
    "delay_between_requests": 1.5,
    "audio_path_map_enabled": False,
    "audio_path_from": "/Volumes/Macintosh HD/Users/jasonfurnell/Dropbox",
    "audio_path_to": "/Users/jason.furnell/Dropbox (Personal)",
}


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return dict(DEFAULT_CONFIG)


def save_config(config_dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(config_dict, f, indent=2)
