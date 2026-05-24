"""
P10.4 tone comparison: before (P10.2 branch, no style guard) vs after (P10.4 branch, with style guard).

Usage (from apps/ai-core/):
    python scripts/eval_p104_tone_compare.py \
        --before scripts/eval_out_p102_extended.json \
        --after  scripts/eval_out_p104_after.json

Outputs a markdown comparison report to scripts/eval_p104_tone_report.md
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Python port of detectCustomerServiceTone (mirrors TS implementation)
# ---------------------------------------------------------------------------

XHS_CS_PHRASES = [
    "随时问我", "随时告诉我", "欢迎了解", "欢迎咨询", "有兴趣的话",
    "如果还有其他问题", "想了解更多", "可以咨询客服", "期待你的反馈",
    "你更看重哪方面", "你有什么特别的使用场景", "你平时用什么",
    "希望能帮到你", "亲亲", "宝子可以", "赶快入手", "不容错过",
]

_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FFFF"
    "☀-⛿"
    "✀-➿"
    "⭐⭕⌚⌛⏩-⏳⏸-⏺"
    "▪▫▶◀◻-◾]",
    re.UNICODE,
)

_TRAILING_QUESTION_RE = re.compile(r"[？?]\s*[\U0001F300-\U0001FFFF☀-➿]*\s*$")


def detect_cs_tone(reply_text: str, platform: str) -> dict:
    if platform not in ("xiaohongshu", "xhs"):
        return {"count": 0, "hits": []}

    hits = []
    for phrase in XHS_CS_PHRASES:
        if phrase in reply_text:
            hits.append(f'CS phrase: "{phrase}"')

    if _TRAILING_QUESTION_RE.search(reply_text.strip()):
        hits.append("trailing question ending")

    emoji_matches = _EMOJI_RE.findall(reply_text)
    if len(emoji_matches) >= 3:
        hits.append(f"excessive emoji: {len(emoji_matches)} found")

    return {"count": len(hits), "hits": hits}


def _reply_length(text: str) -> int:
    return len(text.strip())


def _emoji_count(text: str) -> int:
    return len(_EMOJI_RE.findall(text))


def _trailing_question(text: str) -> bool:
    return bool(_TRAILING_QUESTION_RE.search(text.strip()))


# ---------------------------------------------------------------------------
# Load and annotate
# ---------------------------------------------------------------------------

def annotate(results: list[dict]) -> list[dict]:
    annotated = []
    for r in results:
        draft = r.get("draft", "")
        platform = "xiaohongshu"
        tone = detect_cs_tone(draft, platform)
        annotated.append({
            **r,
            "tone_count": tone["count"],
            "tone_hits": tone["hits"],
            "reply_length": _reply_length(draft),
            "emoji_count": _emoji_count(draft),
            "trailing_question": _trailing_question(draft),
        })
    return annotated


# ---------------------------------------------------------------------------
# Comparison report
# ---------------------------------------------------------------------------

def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def compare(before: list[dict], after: list[dict], out_path: Path) -> None:
    # Match by id
    before_by_id = {r["id"]: r for r in before}
    after_by_id = {r["id"]: r for r in after}
    common_ids = sorted(set(before_by_id) & set(after_by_id))

    b_items = [before_by_id[i] for i in common_ids]
    a_items = [after_by_id[i] for i in common_ids]
    n = len(common_ids)

    b_strategy = sum(1 for r in b_items if r.get("strategy_match"))
    a_strategy = sum(1 for r in a_items if r.get("strategy_match"))

    b_tone = sum(r["tone_count"] for r in b_items)
    a_tone = sum(r["tone_count"] for r in a_items)
    b_items_with_tone = sum(1 for r in b_items if r["tone_count"] > 0)
    a_items_with_tone = sum(1 for r in a_items if r["tone_count"] > 0)

    b_len = _avg([r["reply_length"] for r in b_items])
    a_len = _avg([r["reply_length"] for r in a_items])

    b_trail = sum(1 for r in b_items if r["trailing_question"])
    a_trail = sum(1 for r in a_items if r["trailing_question"])

    b_emoji = _avg([r["emoji_count"] for r in b_items])
    a_emoji = _avg([r["emoji_count"] for r in a_items])

    tone_drop = ((b_tone - a_tone) / b_tone * 100) if b_tone else 0.0

    lines = [
        "# P10.4 Before/After Tone Comparison",
        "",
        "**Before:** P10.2 branch (no XHS style guard)  ",
        "**After:** P10.4 branch (with XHS human-style guard)",
        "",
        f"Items compared: {n}",
        "",
        "## Summary Metrics",
        "",
        "| Metric | Before | After | Change |",
        "|---|---|---|---|",
        f"| Strategy match | {b_strategy}/{n} | {a_strategy}/{n} | *(different branch baseline)* |",
        f"| CS tone hits total | {b_tone} | {a_tone} | {a_tone - b_tone:+d} |",
        f"| Items with CS tone | {b_items_with_tone}/{n} | {a_items_with_tone}/{n} | {a_items_with_tone - b_items_with_tone:+d} |",
        f"| CS tone hit reduction | — | — | **{tone_drop:.0f}%** |",
        f"| Avg reply length (chars) | {b_len:.0f} | {a_len:.0f} | {a_len - b_len:+.0f} |",
        f"| Trailing question endings | {b_trail}/{n} | {a_trail}/{n} | {a_trail - b_trail:+d} |",
        f"| Avg emoji per reply | {b_emoji:.2f} | {a_emoji:.2f} | {a_emoji - b_emoji:+.2f} |",
        "",
        "> Note: Strategy match differs because the Before run used the P10.2 branch",
        "> (which has cross-industry routing patterns), while the After run uses the",
        "> P10.4 branch (based on main, which does not yet include P10.2). Tone",
        "> metrics are branch-independent and reflect prompt changes only.",
        "",
        "---",
        "",
        "## Per-item Tone Comparison",
        "",
        "| Item | Before hits | After hits | Improvement |",
        "|---|---|---|---|",
    ]

    for i in common_ids:
        b = before_by_id[i]
        a = after_by_id[i]
        diff = a["tone_count"] - b["tone_count"]
        tag = "✅ better" if diff < 0 else ("➖ same" if diff == 0 else "⚠️ worse")
        b_phrases = "; ".join(b["tone_hits"]) if b["tone_hits"] else "—"
        a_phrases = "; ".join(a["tone_hits"]) if a["tone_hits"] else "—"
        lines.append(f"| {i} | {b['tone_count']} ({b_phrases}) | {a['tone_count']} ({a_phrases}) | {tag} |")

    lines += ["", "---", "", "## Sample Reply Improvements", ""]

    improved = [i for i in common_ids if before_by_id[i]["tone_count"] > 0 and after_by_id[i]["tone_count"] < before_by_id[i]["tone_count"]]
    for i in improved[:10]:
        b, a = before_by_id[i], after_by_id[i]
        lines += [
            f"### {i}",
            "",
            f"**Comment:** {b.get('comment_text', '')}",
            "",
            f"**Before** (CS hits: {b['tone_count']}): {b.get('draft', '')}",
            "",
            f"**After** (CS hits: {a['tone_count']}): {a.get('draft', '')}",
            "",
            "---",
            "",
        ]

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[compare] Report written to {out_path}")
    print(f"[compare] CS tone hits: {b_tone} before → {a_tone} after ({tone_drop:.0f}% reduction)")
    print(f"[compare] Items with CS tone: {b_items_with_tone} before → {a_items_with_tone} after")
    print(f"[compare] Trailing questions: {b_trail} before → {a_trail} after")
    print(f"[compare] Avg reply length: {b_len:.0f} → {a_len:.0f} chars")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--out", default="scripts/eval_p104_tone_report.md")
    args = parser.parse_args()

    before_raw = json.loads(Path(args.before).read_text(encoding="utf-8"))
    after_raw = json.loads(Path(args.after).read_text(encoding="utf-8"))

    before = annotate(before_raw)
    after = annotate(after_raw)

    compare(before, after, Path(args.out))


if __name__ == "__main__":
    main()
