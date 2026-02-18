# Plan: Extract Shared Abstractions
> Source: `docs/architecture-review.md` — Phase 3
> Priority: Medium (do after or alongside split-monoliths)

## 1. LLMClient (`app/llm.py`)

The provider-routing pattern is duplicated in `tree.py`, `tagger.py`, and `routes.py`:
```python
if provider == "anthropic":
    response = client.messages.create(...)
else:
    response = client.chat.completions.create(...)
```

### Target API
```python
class LLMClient:
    def __init__(self, model, api_keys):
        self.provider = "anthropic" if model.startswith("claude") else "openai"

    @retry(wait=wait_exponential(...), stop=stop_after_attempt(3))
    def call(self, system_prompt, user_prompt, max_tokens=4096):
        # Provider-specific call + response extraction

    def call_json(self, system_prompt, user_prompt, **kwargs):
        # call() + JSON extraction + validation
```

Replaces duplicated provider detection, retry logic, and JSON extraction in all modules.

## 2. BackgroundTaskRunner (`app/background.py`)

4+ places spawn daemon threads with the same pattern: thread + stop_flag + progress_listeners + broadcast function.

### Target API
```python
class BackgroundTask:
    def __init__(self, name, target_fn, progress_callback):
        self.stop_flag = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self): ...
    def stop(self): ...
    def join(self, timeout=5): ...
```

Standardises: tagging thread, genre tree thread, scene tree thread, collection tree thread, artwork workers.

## 3. JsonPersistenceStore (`app/persistence.py`)

Duplicated load/save pattern in `playlist.py` and `setbuilder.py` (global dict + file I/O).

### Target API
```python
class JsonStore:
    def __init__(self, filepath):
        self.filepath = filepath
        self.data = self._load()

    def _load(self): ...
    def save(self): ...
```

## Migration Order
1. `LLMClient` — highest value, used by most modules
2. `BackgroundTask` — needed for clean shutdown (ties into security plan)
3. `JsonStore` — lowest risk, smallest scope
