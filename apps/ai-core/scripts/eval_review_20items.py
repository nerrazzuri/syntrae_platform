"""
Ad-hoc reply review runner for 20 sunglasses + skincare comment items (P10.2 QA).

Generates actual LLM replies for each item using DraftGenerationService with
buyer_stage=None so the P10.2 fallback routing fires.

Usage (from apps/ai-core/):
    python scripts/eval_review_20items.py
    python scripts/eval_review_20items.py --out docs/evals/reply_review_p102.md
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

_env_file = ROOT.parents[1] / ".env.local"
if _env_file.exists():
    for line in _env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

from ai_core.pipeline.llm.llm_client import LLMClient  # noqa: E402
from ai_core.services.draft_service import DraftGenerationService  # noqa: E402

# ---------------------------------------------------------------------------
# Review items
# ---------------------------------------------------------------------------

ITEMS = [
    # -- Sunglasses (10) --
    {"id": "sunglasses_001", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "这是什么品牌呀？", "expected_strategy": "product_question"},
    {"id": "sunglasses_002", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "圆脸适合这款吗？会不会显脸更圆？", "expected_strategy": "suitability_advice"},
    {"id": "sunglasses_003", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "这个有UV400吗？不是偏光还值得买吗？", "expected_strategy": "product_question"},
    {"id": "sunglasses_004", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "小脸戴会不会太大？", "expected_strategy": "suitability_advice"},
    {"id": "sunglasses_005", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "有黑色吗？主页没看到", "expected_strategy": "product_question"},
    {"id": "sunglasses_006", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "可以配度数吗？高度近视能不能戴？", "expected_strategy": "product_question"},
    {"id": "sunglasses_007", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "和小米99那个比怎么样？", "expected_strategy": "comparison_request"},
    {"id": "sunglasses_008", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "有链接吗？想看下价格", "expected_strategy": "purchase_request"},
    {"id": "sunglasses_009", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "猫眼我戴起来很奇怪，是脸型问题还是款式问题？", "expected_strategy": "suitability_advice"},
    {"id": "sunglasses_010", "group": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "这个价格有点高，质感真的有差很多吗？", "expected_strategy": "objection_or_concern"},
    # -- Skincare (10) --
    {"id": "skincare_001", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "敏感肌可以用吗？会不会刺激？", "expected_strategy": "suitability_advice"},
    {"id": "skincare_002", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "这个成分里有没有酒精？", "expected_strategy": "product_question"},
    {"id": "skincare_003", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "孕妇可以用吗？", "expected_strategy": "suitability_advice"},
    {"id": "skincare_004", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "这个会不会闷痘？我是油痘肌", "expected_strategy": "suitability_advice"},
    {"id": "skincare_005", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "早C晚A期间可以叠这个吗？", "expected_strategy": "suitability_advice"},
    {"id": "skincare_006", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "这款精华有烟酰胺吗？", "expected_strategy": "product_question"},
    {"id": "skincare_007", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "和理肤泉比哪个更适合敏感肌？", "expected_strategy": "comparison_request"},
    {"id": "skincare_008", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "多少钱？有试用装吗？", "expected_strategy": "purchase_request"},
    {"id": "skincare_009", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "这个这么贵，真的有必要买吗？", "expected_strategy": "objection_or_concern"},
    {"id": "skincare_010", "group": "skincare", "platform": "xiaohongshu",
     "comment_text": "屏障受损可以用吗？最近脸很容易泛红", "expected_strategy": "suitability_advice"},
]

# ---------------------------------------------------------------------------
# Brand configs
# ---------------------------------------------------------------------------

BRANDS = {
    "sunglasses": {
        "brand_name": "VISTA",
        "brand_domain": "vistaframes.com",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "zh-CN",
        "brand_reply_profile": {
            "reply_principles": ["先判断具体问题，再给建议", "不要夸大防晒效果"],
            "forbidden_phrases": ["不要像客服", "完美适合所有脸型"],
            "diagnostic_factors": ["镜框宽度", "镜片大小", "上扬角度", "鼻梁贴合度", "脸型比例", "穿搭风格"],
            "customer_concerns": ["显脸大", "低鼻梁", "压鼻梁", "不适合脸型", "拍照不自然"],
        },
    },
    "skincare": {
        "brand_name": "LUMIÈRE",
        "brand_domain": "lumiereskin.com",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "zh-CN",
        "brand_reply_profile": {
            "reply_principles": ["先理解用户的实际问题，再给建议", "不要承诺绝对效果"],
            "forbidden_phrases": ["一定不会过敏", "绝对安全", "百分之百有效"],
            "diagnostic_factors": ["肤质", "成分耐受度", "皮肤屏障状态"],
        },
    },
}

# ---------------------------------------------------------------------------
# Mock DB
# ---------------------------------------------------------------------------


class _FakeQuery:
    def __init__(self, lead: SimpleNamespace):
        self._lead = lead

    def filter(self, *args):
        return self

    def first(self) -> SimpleNamespace:
        return self._lead


class _FakeDB:
    def __init__(self, lead: SimpleNamespace):
        self._lead = lead

    def query(self, _model):
        return _FakeQuery(self._lead)


def _make_lead(platform: str) -> SimpleNamespace:
    return SimpleNamespace(
        id="eval-synthetic",
        account_id="eval-account",
        platform=platform,
        intent=None,
        buyer_stage=None,
        confidence=0.85,
        risk_level="LOW",
        recommended_action="PRIORITY_DM",
        preferences={},
    )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def run_items(llm: LLMClient) -> list[dict]:
    results = []
    total = len(ITEMS)

    for i, item in enumerate(ITEMS, 1):
        brand = BRANDS[item["group"]]
        lead = _make_lead(platform=item["platform"])
        db = _FakeDB(lead)
        svc = DraftGenerationService(db, llm)

        owner_settings = {
            **brand,
            "comment_text": item["comment_text"],
            "platform": item["platform"],
            "intent": None,
        }

        try:
            result = svc.generate_draft(
                lead_id="eval-synthetic",
                account_id="eval-account",
                owner_settings=owner_settings,
            )
            draft = result.get("draft_text", "[no draft_text]")
            strategy = result.get("reply_strategy", "")
        except Exception as exc:
            draft = f"[ERROR] {exc}"
            strategy = ""

        match = strategy == item["expected_strategy"]

        results.append({
            "id": item["id"],
            "group": item["group"],
            "comment_text": item["comment_text"],
            "expected_strategy": item["expected_strategy"],
            "actual_strategy": strategy,
            "strategy_match": match,
            "draft": draft,
        })

        status = "✓" if match else "✗"
        sys.stdout.write(f"\r  [{i}/{total}] {status} {item['id']:<20}")
        sys.stdout.flush()

    print()
    return results


# ---------------------------------------------------------------------------
# Markdown output
# ---------------------------------------------------------------------------


def write_markdown(results: list[dict], out_path: Path) -> None:
    sunglasses = [r for r in results if r["group"] == "sunglasses"]
    skincare = [r for r in results if r["group"] == "skincare"]

    total = len(results)
    matched = sum(1 for r in results if r["strategy_match"])

    lines = [
        "# Reply Review — P10.2 Routing QA (20 Items)",
        "",
        f"**Branch:** `feature/evals-p102-cross-industry-routing`  ",
        f"**Total:** {total} items  |  **Strategy match:** {matched}/{total}",
        "",
        "Routing uses `adapt_reply_strategy` with `buyer_stage=None` and `intent=None`  ",
        "so P10.2 content-based fallback fires for every item.",
        "",
        "---",
        "",
    ]

    for group_label, group_results, brand_name in [
        ("Sunglasses — VISTA (10 items)", sunglasses, "VISTA"),
        ("Skincare — LUMIÈRE (10 items)", skincare, "LUMIÈRE"),
    ]:
        g_matched = sum(1 for r in group_results if r["strategy_match"])
        lines += [
            f"## {group_label}",
            "",
            f"Strategy match: **{g_matched}/{len(group_results)}**",
            "",
        ]

        for r in group_results:
            match_icon = "✅" if r["strategy_match"] else "❌"
            strategy_line = r["actual_strategy"]
            if not r["strategy_match"]:
                strategy_line += f" ← expected `{r['expected_strategy']}`"

            lines += [
                f"### {r['id']}  {match_icon}",
                "",
                f"**Comment:** {r['comment_text']}  ",
                f"**Strategy:** `{strategy_line}`  ",
                "",
                f"> {r['draft']}",
                "",
                "---",
                "",
            ]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[review] Written to {out_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    parser = argparse.ArgumentParser(description="Reply review for 20 comment items")
    parser.add_argument(
        "--out",
        default=str(ROOT.parents[1] / "docs" / "evals" / "reply_review_p102.md"),
        help="Output markdown path",
    )
    args = parser.parse_args()

    print("[review] Generating replies for 20 items ...")
    llm = LLMClient()
    results = run_items(llm)

    matched = sum(1 for r in results if r["strategy_match"])
    print(f"\n[review] Strategy match: {matched}/{len(results)}")

    mismatches = [r for r in results if not r["strategy_match"]]
    if mismatches:
        print("[review] Mismatches:")
        for r in mismatches:
            print(f"  {r['id']}: got {r['actual_strategy']!r} expected {r['expected_strategy']!r}")

    write_markdown(results, Path(args.out))


if __name__ == "__main__":
    main()
