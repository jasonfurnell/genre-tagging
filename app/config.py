import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")

DEFAULT_SYSTEM_PROMPT = "You are a music genre expert and DJ selector."

DEFAULT_USER_PROMPT_TEMPLATE = (
    'Describe the track for DJs in one line. Include decade and country if possible. '
    'Use vivid club-friendly phrasing. Avoid repeating genre terms and keep the tone '
    'colorful and stylish.\n'
    'Format: <Main genre>; <production traits>; <scene/mood/era info>.\n\n'
    'Track title: "{title}"\n'
    'Artist: {artist}'
)

DEFAULT_CONFIG = {
    "system_prompt": DEFAULT_SYSTEM_PROMPT,
    "user_prompt_template": DEFAULT_USER_PROMPT_TEMPLATE,
    "delay_between_requests": 1.5,
}


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return dict(DEFAULT_CONFIG)


def save_config(config_dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(config_dict, f, indent=2)
