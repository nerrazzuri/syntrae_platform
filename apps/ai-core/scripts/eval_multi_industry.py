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
import re
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


# ---------------------------------------------------------------------------
# Negation-aware hallucination detection
# Mirrors isNegatedMention + detectUnsupportedFacts from TypeScript (P10.1b)
# ---------------------------------------------------------------------------

_AP = r"['’]"  # ASCII apostrophe OR Unicode right single quote

_EN_NEGATION_PATTERNS = [
    re.compile(r'\bno\b'),
    re.compile(r'\bnot\b'),
    re.compile(rf"doesn{_AP}t"),
    re.compile(r'does\s+not'),
    re.compile(rf"don{_AP}t"),
    re.compile(r'do\s+not'),
    re.compile(rf"isn{_AP}t"),
    re.compile(r'is\s+not'),
    re.compile(rf"aren{_AP}t"),
    re.compile(r'are\s+not'),
    re.compile(r'\bwithout\b'),
    re.compile(r'\bunavailable\b'),
    re.compile(r'not\s+supported'),
    re.compile(r'not\s+directly'),
    re.compile(r'no\s+native'),
    re.compile(r'no\s+dedicated'),
    re.compile(r'cannot\s+confirm'),
    re.compile(r'not\s+confirmed'),
    re.compile(rf"can{_AP}t\s+confirm"),
]

_ZH_NEGATIONS_MULTI = ['不含', '没有', '没看到', '暂不', '不是', '不支持', '不能确认', '资料里没有']
_ZH_NEGATIONS_SINGLE = ['不', '未', '无']


def _is_negated_mention(text: str, keyword: str, window_chars: int = 60) -> bool:
    """Return True when keyword appears in text inside a negation window."""
    lower = text.lower()
    kw_lower = keyword.lower()
    idx = 0
    while idx < len(lower):
        pos = lower.find(kw_lower, idx)
        if pos == -1:
            break
        kw_end = pos + len(kw_lower)

        # Full ±window for English + multi-char Chinese negations
        full_start = max(0, pos - window_chars)
        full_end = min(len(lower), kw_end + window_chars)
        full_window_lower = lower[full_start:full_end]
        full_window_orig = text[full_start:full_end]

        for pattern in _EN_NEGATION_PATTERNS:
            if pattern.search(full_window_lower):
                return True
        for neg in _ZH_NEGATIONS_MULTI:
            if neg in full_window_orig:
                return True

        # Tight prefix-only window for single-char Chinese negations
        tight_start = max(0, pos - 10)
        tight_window = text[tight_start:kw_end]
        for neg in _ZH_NEGATIONS_SINGLE:
            if neg in tight_window:
                return True

        idx = pos + 1
    return False


_GDPR_CLAIM_PATTERNS = [
    'gdpr compliant', 'gdpr-compliant', 'gdpr compliance',
    'gdpr-ready', 'gdpr aligned', 'comply with gdpr',
]

_DATA_RESIDENCY_COUNTRIES = [
    'united states', 'united kingdom', 'singapore', 'germany',
    'japan', 'australia', 'canada', 'china', 'india', 'ireland',
]

_DATA_RESIDENCY_REGION_RE = re.compile(
    r'(?:stored|hosted|located|based)\s+in\s+(?:the\s+)?(?:us|eu|europe|usa|uk)\b', re.IGNORECASE
)


def detect_unsupported_facts(reply_text: str, product_context: dict) -> list[str]:
    """Return a list of unsupported factual claims in reply_text (negation-aware)."""
    facts: list[str] = []
    reply = reply_text.lower()

    unknowns: list[str] = [u.lower() for u in (product_context.get("unknowns") or [])]
    not_claimed: list[str] = [c.lower() for c in (product_context.get("not_claimed") or [])]
    not_supported: list[str] = product_context.get("not_supported") or []
    ingredients: list[str] = [i.lower() for i in (product_context.get("ingredients_summary") or [])]
    free_from: list[str] = [f.lower() for f in (product_context.get("free_from") or [])]
    integrations: list[str] = [i.lower() for i in (product_context.get("integrations") or [])]
    security: dict = product_context.get("security") or {}
    pricing: dict = product_context.get("pricing") or {}

    # SPF claim when SPF is unknown
    if any("spf" in u for u in unknowns):
        m = re.search(r"spf\s*\d+", reply)
        if m and not _is_negated_mention(reply_text, m.group(0)):
            facts.append("SPF value stated but listed as unknown")

    # Niacinamide / 烟酰胺 not in ingredients
    if not any("niacinamide" in i for i in ingredients):
        has_en = "niacinamide" in reply
        has_zh = "烟酰胺" in reply_text
        if (has_en and not _is_negated_mention(reply_text, "niacinamide")) or \
           (has_zh and not _is_negated_mention(reply_text, "烟酰胺")):
            facts.append("niacinamide / 烟酰胺 claimed but not in ingredients_summary")

    # Alcohol-free when alcohol not in free_from
    if not any("alcohol" in f for f in free_from):
        if "alcohol-free" in reply and not _is_negated_mention(reply_text, "alcohol-free"):
            facts.append("alcohol-free claimed but not in free_from")
        if "不含酒精" in reply_text and not _is_negated_mention(reply_text, "不含酒精"):
            facts.append("alcohol-free claimed but not in free_from")

    # Pregnancy safe when in not_claimed
    if any("pregnancy" in c for c in not_claimed):
        pregnancy_terms = [
            ("pregnancy safe", "pregnancy safe" in reply),
            ("safe for pregnant", "safe for pregnant" in reply),
            ("孕妇可以用", "孕妇可以用" in reply_text),
            ("孕期可以用", "孕期可以用" in reply_text),
        ]
        for term, present in pregnancy_terms:
            if present and not _is_negated_mention(reply_text, term):
                facts.append("pregnancy safe claimed but listed in not_claimed")
                break

    # Wear time duration when listed as unknown
    if any("wear time" in u for u in unknowns):
        m = re.search(r"\b\d+[\s\-]+\d+\s*hours?\b", reply) or \
            re.search(r"\b\d+\s*hours?\s*(of\s+)?wear\b", reply)
        if m and not _is_negated_mention(reply_text, m.group(0)):
            facts.append("wear time duration stated but listed as unknown")
        elif "小时持妆" in reply_text and not _is_negated_mention(reply_text, "小时持妆"):
            facts.append("wear time duration stated but listed as unknown")
        elif "小时不脱色" in reply_text and not _is_negated_mention(reply_text, "小时不脱色"):
            facts.append("wear time duration stated but listed as unknown")

    # Waterproof when in not_claimed
    if any("waterproof" in c for c in not_claimed):
        if "waterproof" in reply and not _is_negated_mention(reply_text, "waterproof"):
            facts.append("waterproof claimed but listed in not_claimed")

    # SaaS: features in not_supported
    for feature in not_supported:
        fl = feature.lower()
        if fl in reply and not _is_negated_mention(reply_text, feature):
            facts.append(f'"{feature}" claimed but listed in not_supported')

    # SaaS: Slack not in integrations
    if not any("slack" in i for i in integrations):
        if "slack" in reply and not _is_negated_mention(reply_text, "slack"):
            facts.append("Slack integration claimed but not in integrations")

    # SaaS: Salesforce unknown
    if any("salesforce" in u for u in unknowns):
        if "salesforce" in reply and not _is_negated_mention(reply_text, "salesforce"):
            facts.append("Salesforce integration claimed but listed as unknown")

    # SaaS: security — encrypted at rest
    if security.get("encryption_at_rest") == "unknown":
        if "encrypted at rest" in reply and not _is_negated_mention(reply_text, "encrypted at rest"):
            facts.append("encrypted at rest claimed but listed as unknown")

    # SaaS: GDPR — broadened patterns
    if security.get("gdpr") == "not confirmed":
        for pat in _GDPR_CLAIM_PATTERNS:
            if pat in reply and not _is_negated_mention(reply_text, pat):
                facts.append("GDPR compliant claimed but not confirmed")
                break

    # Data residency when unknown
    if any(re.search(r'data.?residency|data.*country', u) for u in unknowns):
        claimed = None
        for country in _DATA_RESIDENCY_COUNTRIES:
            if country in reply and not _is_negated_mention(reply_text, country):
                claimed = country
                break
        if not claimed:
            m = _DATA_RESIDENCY_REGION_RE.search(reply)
            if m and not _is_negated_mention(reply_text, m.group(0)):
                claimed = m.group(0)
        if claimed:
            facts.append("data residency location claimed but listed as unknown")

    # SaaS: free trial contradiction (denial IS the hallucination — no negation check)
    trial = pricing.get("free_trial")
    if trial and trial != "none":
        if "no free trial" in reply or "don't offer a free trial" in reply:
            facts.append(f"free trial contradiction: product has {trial} trial but reply denies it")

    return facts


# ---------------------------------------------------------------------------
# Product context → knowledge_context entry
# The standard _format_product_context only reads catalog-schema fields
# (key_benefits, description, etc.). Our eval contexts use a different schema
# (ingredients_summary, unknowns, not_supported, etc.), so we also inject the
# full eval context as a knowledge_context entry so the LLM sees all facts.
# ---------------------------------------------------------------------------

def _product_context_to_knowledge_entry(ctx: dict) -> dict:
    """Render an eval product_context as a knowledge_context document entry."""
    name = ctx.get("name") or "Product"
    lines = [f"Product facts for {name}:"]

    for key in ("category", "volume", "shade", "finish", "texture"):
        if ctx.get(key):
            lines.append(f"  {key}: {ctx[key]}")

    for key, label in [
        ("features", "Supported features"),
        ("integrations", "Integrations"),
        ("ingredients_summary", "Ingredients"),
        ("free_from", "Free from"),
        ("claims", "Confirmed claims"),
    ]:
        vals = ctx.get(key)
        if vals:
            lines.append(f"  {label}: {', '.join(str(v) for v in vals)}")

    for key, label in [
        ("not_claimed", "NOT claimed (do not assert)"),
        ("not_supported", "NOT supported (do not claim)"),
        ("unknowns", "Unknown (do not invent)"),
    ]:
        vals = ctx.get(key)
        if vals:
            lines.append(f"  {label}: {', '.join(str(v) for v in vals)}")

    security = ctx.get("security")
    if security:
        sec_parts = []
        if security.get("encryption_in_transit") is True:
            sec_parts.append("encrypted in transit: YES")
        if security.get("encryption_at_rest") == "unknown":
            sec_parts.append("encrypted at rest: UNKNOWN (do not claim)")
        if security.get("gdpr") == "not confirmed":
            sec_parts.append("GDPR: not confirmed (do not claim compliant)")
        if sec_parts:
            lines.append(f"  Security: {'; '.join(sec_parts)}")

    pricing = ctx.get("pricing")
    if pricing:
        p_parts = []
        for k, v in pricing.items():
            p_parts.append(f"{k}: {v}")
        lines.append(f"  Pricing: {', '.join(p_parts)}")

    usage_notes = ctx.get("usage_notes")
    if usage_notes:
        lines.append(f"  Usage notes: {', '.join(usage_notes)}")

    return {
        "document_title": f"Product facts: {name}",
        "content": "\n".join(lines),
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


def _make_lead(platform: str, intent: str | None = None) -> SimpleNamespace:
    # buyer_stage=None so the adapter's content-based fallback fires.
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


# ---------------------------------------------------------------------------
# Pack runner
# ---------------------------------------------------------------------------

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
        product_context = item.get("product_context") or {}
        lead = _make_lead(platform=platform, intent=None)
        db = _FakeDB(lead)
        svc = DraftGenerationService(db, llm)

        # Pass product_context both as structured field (for catalog schema fields
        # like name/category) and as a knowledge_context entry (for all grounding
        # facts that the standard formatter does not read).
        knowledge_entry = _product_context_to_knowledge_entry(product_context)

        owner_settings = {
            **brand,
            "comment_text": item["comment_text"],
            "platform": platform,
            "intent": None,
            "product_context": product_context,
            "knowledge_context": [knowledge_entry],
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

        unsupported = detect_unsupported_facts(draft, product_context) if product_context else []

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
            "unsupported_facts": unsupported,
            "unsupported_fact_count": len(unsupported),
        })

        sys.stdout.write(f"\r  [{i}/{len(items)}]")
        sys.stdout.flush()

    print()
    return results


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def print_report(pack_name: str, results: list[dict]) -> None:
    sep = "─" * 80
    brand = BRAND_DEFAULTS[pack_name]

    print(f"\n{'═' * 80}")
    print(f"  Pack: {pack_name}  |  Brand: {brand['brand_name']}  |  {len(results)} items")
    print(f"{'═' * 80}")

    strategy_match_count = sum(1 for r in results if r["strategy_match"])
    total_unsupported = sum(r["unsupported_fact_count"] for r in results)
    items_with_hallucination = sum(1 for r in results if r["unsupported_fact_count"] > 0)

    print(f"\nStrategy match:       {strategy_match_count}/{len(results)}")
    print(f"Unsupported facts:    {total_unsupported} total  ({items_with_hallucination} items affected)\n")

    for r in results:
        match_tag = "✓" if r["strategy_match"] else "✗"
        hall_tag = f"  ⚠ {r['unsupported_fact_count']} hallucination(s)" if r["unsupported_fact_count"] else ""
        print(sep)
        print(f"[{r['id']}] {match_tag} strategy={r['actual_strategy']!r} (expected={r['expected_strategy']!r}){hall_tag}")
        print(f"COMMENT:  {r['comment_text']}")
        print(f"DRAFT:    {r['draft']}")
        if r["unsupported_facts"]:
            for fact in r["unsupported_facts"]:
                print(f"  HALLUCINATION: {fact}")
        print(f"NOTES:    {'; '.join(r['expected_notes'])}")
        print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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
