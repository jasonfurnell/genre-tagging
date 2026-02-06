import logging
from tenacity import retry, wait_fixed, stop_after_attempt, retry_if_exception_type, before_sleep_log

logger = logging.getLogger(__name__)


@retry(
    wait=wait_fixed(5),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type(Exception),
    before_sleep=before_sleep_log(logger, logging.INFO),
)
def generate_genre_comment(client, title, artist, system_prompt, user_prompt_template,
                           bpm="", key="", year="", model="gpt-4", provider="openai"):
    prompt = user_prompt_template.format(
        title=title,
        artist=artist,
        bpm=bpm,
        key=key,
        year=year,
    )

    if provider == "anthropic":
        response = client.messages.create(
            model=model,
            max_tokens=256,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt.strip()}],
        )
        return response.content[0].text.strip()

    # OpenAI (default)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt.strip()},
        ],
    )
    return response.choices[0].message.content.strip()
