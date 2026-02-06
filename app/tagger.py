import logging
import re
from tenacity import retry, wait_fixed, stop_after_attempt, retry_if_exception_type, before_sleep_log

logger = logging.getLogger(__name__)

_YEAR_MISSING_INSTRUCTION = (
    "\nThe release year is missing. On a new line after your description, "
    "write only: RELEASE_YEAR: YYYY"
)

_RELEASE_YEAR_RE = re.compile(r"\n?RELEASE_YEAR:\s*(\d{4})\s*$")


def _year_is_missing(year):
    return not year or str(year).strip() in ("", "0", "0.0", "nan")


@retry(
    wait=wait_fixed(5),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
    before_sleep=before_sleep_log(logger, logging.INFO),
)
def generate_genre_comment(client, title, artist, system_prompt, user_prompt_template,
                           bpm="", key="", year="", model="gpt-4", provider="openai"):
    """Returns (comment, detected_year) where detected_year is a string or None."""
    needs_year = _year_is_missing(year)

    prompt = user_prompt_template.format(
        title=title,
        artist=artist,
        bpm=bpm,
        key=key,
        year=year if not needs_year else "Unknown",
    )
    if needs_year:
        prompt += _YEAR_MISSING_INSTRUCTION

    if provider == "anthropic":
        response = client.messages.create(
            model=model,
            max_tokens=256,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt.strip()}],
        )
        raw = response.content[0].text.strip()
    else:
        # OpenAI (default)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt.strip()},
            ],
        )
        raw = response.choices[0].message.content.strip()

    detected_year = None
    if needs_year:
        m = _RELEASE_YEAR_RE.search(raw)
        if m:
            detected_year = m.group(1)
            raw = _RELEASE_YEAR_RE.sub("", raw).strip()

    return raw, detected_year
