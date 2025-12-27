from __future__ import annotations

import os
import re
import hashlib


class Redactor:
    def __init__(self, mode: str | None = None) -> None:
        self.mode = (mode or os.getenv("PII_REDACTION_MODE", "redact")).lower()
        self.patterns = {
            "EMAIL": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
            "PHONE": re.compile(
                r"\b(?:\+?\d[\s-]?)?(?:\(?\d{2,3}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}\b"
            ),
            "NRIC": re.compile(r"\b[STFG]\d{7}[A-Z]\b", re.IGNORECASE),
            "NRIC_MY": re.compile(r"\b\d{6}-\d{2}-\d{4}\b"),
            "ADDRESS": re.compile(r"\b\d+\s+[A-Za-z0-9\s,.-]+\b"),
        }

    def _hash(self, value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]

    def sanitize(self, text: str) -> str:
        if not text:
            return text
        if self.mode == "allow":
            return text

        def repl(kind: str):
            def _inner(m):
                v = m.group(0)
                if self.mode == "hash":
                    return f"<{kind}:{self._hash(v)}>"
                return f"<{kind}>"

            return _inner

        out = text
        for kind, pat in self.patterns.items():
            if kind == "ADDRESS" and os.getenv("PII_REDACT_ADDRESS", "1") not in (
                "1",
                "true",
                "yes",
            ):
                continue
            out = pat.sub(repl(kind), out)
        return out
