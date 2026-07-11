import time
from typing import Optional


class RateLimiter:
    """Nejjednodušší in-memory sliding-window limiter (best-effort).

    Pozn.: na serverless (více instancí) je to jen orientační ochrana proti
    hrubému brute-force; tvrdý limit patří na infra vrstvu (APIM / Front Door).
    """

    def __init__(self, max_calls: int, window_seconds: float) -> None:
        self.max_calls = max_calls
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, now: Optional[float] = None) -> bool:
        now = time.time() if now is None else now
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        if len(hits) >= self.max_calls:
            self._hits[key] = hits
            return False
        hits.append(now)
        self._hits[key] = hits
        return True
