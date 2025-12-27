from __future__ import annotations

"""Load secrets from Docker-style *_FILE environment variables.

If an environment variable ends with _FILE and points to a readable file,
read its contents and set the corresponding base variable without the _FILE suffix.

Example: JWT_SECRET_FILE=/run/secrets/jwt_secret -> sets JWT_SECRET to file content
"""

import os


def load_file_env_secrets(prefixes: tuple[str, ...] = ("",)) -> None:
    for key, val in list(os.environ.items()):
        if not key.endswith("_FILE"):
            continue
        base = key[:-5]
        if prefixes and not any(base.startswith(p) for p in prefixes if p):
            # If prefixes are provided, only load those
            continue
        path = val
        try:
            if path and os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                if content:
                    os.environ[base] = content
        except Exception:
            # best-effort; do not raise
            pass


