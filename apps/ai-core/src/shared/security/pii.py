from __future__ import annotations

import re
from shared.config.tuning import memory as mem_cfg


_PII_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PII_PHONE = re.compile(r"\b(?:\+?\d[\s-]?){7,14}\b")
_PII_ID_GENERIC = re.compile(r"\b[A-Z0-9]{6,12}\b")
_PII_DOB_1 = re.compile(r"\b\d{2}/\d{2}/\d{4}\b")
_PII_DOB_2 = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_PII_ADDRESS = re.compile(
    r"\b(Street|St\.|Jalan|Blk|Avenue|Ave\.|Road|Rd\.)\b", re.IGNORECASE
)


def redact(text: str) -> str:
    s = text or ""
    s = _PII_EMAIL.sub("[REDACTED_EMAIL]", s)
    s = _PII_PHONE.sub("[REDACTED_PHONE]", s)
    if mem_cfg.pii_extended:
        s = _PII_DOB_1.sub("[REDACTED_DOB]", s)
        s = _PII_DOB_2.sub("[REDACTED_DOB]", s)
        s = _PII_ID_GENERIC.sub("[REDACTED_ID]", s)
        s = _PII_ADDRESS.sub("[REDACTED_ADDR]", s)
    return s
