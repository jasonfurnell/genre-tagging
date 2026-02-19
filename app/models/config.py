"""Application config models — maps to config.json."""

from __future__ import annotations

from pydantic import BaseModel


class AppConfig(BaseModel):
    """Full application config as persisted in config.json."""

    model: str = "claude-sonnet-4-5-20250929"
    system_prompt: str = "You are a music genre expert and DJ selector."
    user_prompt_template: str = (
        'Describe this track for DJs in one concise sentence (15\u201325 words). '
        "Do not repeat the main genre name in the description fields. "
        "Use vivid, club-friendly phrasing.\n"
        "Format: Main genre; Sub genre; production traits; scene/mood/country; "
        "area of origin, era info.\n"
        "Example: New Wave; Synth-pop; seductive synth, driving drum patterns, "
        "catchy guitar riffs; boundary-pushing 80s glam rock scene; UK, early 80s. "
        "late-night Ibiza terrace, mid-2010s.\n\n"
        'Track title: "{title}"\n'
        "Artist: {artist}\n"
        "BPM: {bpm}\n"
        "Key: {key}\n"
        "Year: {year}"
    )
    delay_between_requests: float = 1.5
    audio_path_map_enabled: bool = False
    audio_path_from: str = "/Volumes/Macintosh HD/Users/jasonfurnell/Dropbox"
    audio_path_to: str = "/Users/jason.furnell/Dropbox (Personal)"
    dropbox_path_prefix: str = ""
