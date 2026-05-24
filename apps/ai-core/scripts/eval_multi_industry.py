"""
Multi-industry eval runner for P10 fixture packs.

Uses DraftGenerationService directly with a mock DB (no live DB required).
Reads fixtures from apps/operator-api/fixtures/evals/.

Usage (from apps/ai-core/):
    python scripts/eval_multi_industry.py --pack skincare_xhs
    python scripts/eval_multi_industry.py --pack makeup_xhs
    python scripts/eval_multi_industry.py --pack saas_b2b
    python scripts/eval_multi_industry.py --pack all
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
FIXTURES = ROOT.parents[1] / "apps" / "operator-api" / "fixtures" / "evals"

# Fall back to repo-root-relative path for when script runs from anywhere
if not FIXTURES.exists():
    FIXTURES = ROOT.parents[0] / "operator-api" / "fixtures" / "evals"

sys.path.insert(0, str(SRC))

# Load env from .env.local so OPENAI_API_KEY is available when running locally
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

PACK_FILES = {
    "skincare_xhs": "skincare_xhs_eval.json",
    "makeup_xhs": "makeup_xhs_eval.json",
    "saas_b2b": "saas_b2b_eval.json",
}

BRAND_DEFAULTS = {
    "skincare_xhs": {
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
    "makeup_xhs": {
        "brand_name": "VELVET",
        "brand_domain": "velvtmakeup.com",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "zh-CN",
        "brand_reply_profile": {
            "reply_principles": ["先给具体色号/适用建议，再给购买引导", "不要夸大显色/持妆效果"],
            "forbidden_phrases": ["所有肤色都适合", "一定持妆24小时"],
            "diagnostic_factors": ["肤色深浅", "冷暖色调", "肤质"],
        },
    },
    "saas_b2b": {
        "brand_name": "FlowDesk",
        "brand_domain": "flowdesk.io",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "en",
        "brand_reply_profile": {
            "reply_principles": ["Answer the exact question first", "Do not invent features"],
            "forbidden_phrases": ["industry-leading", "best-in-class", "seamless"],
            "diagnostic_factors": [],
        },
    },
}


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


def _make_lead(platform: str, intent: str | None = None) -> SimpleNamespace:
    # buyer_stage=None so the adapter's content-based fallback fires.
    # Real leads have stored intents; synthetic eval leads don't, so we let the
    # adapter classify from comment_text the same way it does for null-intent leads.
    return SimpleNamespace(
        id="eval-synthetic",
        account_id="eval-account",
        platform=platform,
        intent=intent,
        buyer_stage=None,
        confidence=0.85,
        risk_level="LOW",
        recommended_action="PRIORITY_DM",
        preferences={},
    )


def load_pack(pack_name: str) -> list[dict]:
    fname = PACK_FILES.get(pack_name)
    if not fname:
        raise ValueError(f"Unknown pack: {pack_name!r}. Available: {list(PACK_FILES)}")
    path = FIXTURES / fname
    return json.loads(path.read_text(encoding="utf-8"))


def run_pack(pack_name: str, llm: LLMClient) -> list[dict]:
    items = load_pack(pack_name)
    brand = BRAND_DEFAULTS[pack_name]
    results = []

    for i, item in enumerate(items, 1):
        platform = item["platform"]
        intent = None  # use expected_reply_strategy to hint, or leave null to let adapter decide
        lead = _make_lead(platform=platform, intent=intent)
        db = _FakeDB(lead)
        svc = DraftGenerationService(db, llm)

        owner_settings = {
            **brand,
            "comment_text": item["comment_text"],
            "platform": platform,
            "intent": None,
            # buyer_stage intentionally omitted so the adapter uses the lead's
            # null value, which enables content-based fallback classification
        }

        try:
            result = svc.generate_draft(
                lead_id="eval-synthetic",
                account_id="eval-account",
                owner_settings=owner_settings,
            )
            draft = result.get("draft_text", "[no draft_text]")
            strategy = result.get("reply_strategy", "")
            should_redirect = result.get("strategy_meta", {}).get("should_redirect", False)
        except Exception as exc:
            draft = f"[ERROR] {exc}"
            strategy = ""
            should_redirect = False

        results.append({
            "id": item["id"],
            "comment_text": item["comment_text"],
            "scenario": item["scenario"],
            "expected_strategy": item["expected_reply_strategy"],
            "expected_redirect": item["expected_should_redirect"],
            "actual_strategy": strategy,
            "actual_redirect": should_redirect,
            "strategy_match": strategy == item["expected_reply_strategy"],
            "draft": draft,
            "expected_notes": item["expected_notes"],
        })

        sys.stdout.write(f"\r  [{i}/{len(items)}]")
        sys.stdout.flush()

    print()
    return results


def print_report(pack_name: str, results: list[dict]) -> None:
    sep = "─" * 80
    brand = BRAND_DEFAULTS[pack_name]

    print(f"\n{'═' * 80}")
    print(f"  Pack: {pack_name}  |  Brand: {brand['brand_name']}  |  {len(results)} items")
    print(f"{'═' * 80}")

    strategy_match_count = sum(1 for r in results if r["strategy_match"])
    print(f"\nStrategy match: {strategy_match_count}/{len(results)}\n")

    for r in results:
        match_tag = "✓" if r["strategy_match"] else "✗"
        print(sep)
        print(f"[{r['id']}] {match_tag} strategy={r['actual_strategy']!r} (expected={r['expected_strategy']!r})")
        print(f"COMMENT:  {r['comment_text']}")
        print(f"DRAFT:    {r['draft']}")
        print(f"NOTES:    {'; '.join(r['expected_notes'])}")
        print()


def main() -> None:
    # Force UTF-8 stdout for Windows compatibility
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    parser = argparse.ArgumentParser(description="Multi-industry eval runner")
    parser.add_argument(
        "--pack",
        choices=[*PACK_FILES.keys(), "all"],
        required=True,
        help="Eval pack to run",
    )
    parser.add_argument("--out", help="Write JSON results to file")
    args = parser.parse_args()

    llm = LLMClient()
    pack_names = list(PACK_FILES.keys()) if args.pack == "all" else [args.pack]
    all_results: dict[str, list[dict]] = {}

    for pack_name in pack_names:
        print(f"\n[eval] Running pack: {pack_name} ...")
        results = run_pack(pack_name, llm)
        all_results[pack_name] = results
        print_report(pack_name, results)

    if args.out:
        out_path = Path(args.out)
        out_path.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[eval] Results written to {args.out}")


if __name__ == "__main__":
    main()
