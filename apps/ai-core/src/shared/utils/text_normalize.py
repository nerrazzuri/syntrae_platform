from __future__ import annotations

import re
import textwrap


def normalize_multiline_text(text: str) -> str:
    if text is None:
        return ""
    # Dedent and normalize newlines (preserve single \n)
    s = textwrap.dedent(text)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse excessive blank lines; reduce double newlines to single to keep tight lists
    s = re.sub(r"\n{2,}", "\n", s)
    # Trim leading/trailing blank lines
    s = s.strip("\n ")
    # Collapse long runs of spaces (but keep single spaces)
    s = re.sub(r" {2,}", " ", s)
    return s
