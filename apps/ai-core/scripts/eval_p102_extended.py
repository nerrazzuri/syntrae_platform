"""
P10.2 Extended eval — 50 items across 5 industries.

Tests routing + reply quality for industries beyond the original 3 packs.
Runs DraftGenerationService with null intent/buyer_stage so P10.2 fallback routing fires.

Usage (from apps/ai-core/):
    python scripts/eval_p102_extended.py
    python scripts/eval_p102_extended.py --out eval_out_extended.json
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
# Inline eval items — 50 items across 5 industries
# ---------------------------------------------------------------------------

EVAL_ITEMS = [
    # ── Sunglasses ──────────────────────────────────────────────────────────
    {"id": "sunglasses_001", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "这是什么品牌呀？", "expected_strategy": "product_question"},
    {"id": "sunglasses_002", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "圆脸适合这款吗？会不会显脸更圆？", "expected_strategy": "suitability_advice"},
    {"id": "sunglasses_003", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "这个有UV400吗？不是偏光还值得买吗？", "expected_strategy": "product_question"},
    {"id": "sunglasses_004", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "小脸戴会不会太大？", "expected_strategy": "suitability_advice"},
    {"id": "sunglasses_005", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "有黑色吗？主页没看到", "expected_strategy": "product_question"},
    {"id": "sunglasses_006", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "可以配度数吗？高度近视能不能戴？", "expected_strategy": "product_question"},
    {"id": "sunglasses_007", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "和小米99那个比怎么样？", "expected_strategy": "comparison_request"},
    {"id": "sunglasses_008", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "有链接吗？想看下价格", "expected_strategy": "purchase_request"},
    {"id": "sunglasses_009", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "猫眼我戴起来很奇怪，是脸型问题还是款式问题？", "expected_strategy": "suitability_advice"},
    {"id": "sunglasses_010", "industry": "sunglasses", "platform": "xiaohongshu",
     "comment_text": "这个价格有点高，质感真的有差很多吗？", "expected_strategy": "objection_or_concern"},

    # ── Skincare ─────────────────────────────────────────────────────────────
    {"id": "skincare_001", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "敏感肌可以用吗？会不会刺激？", "expected_strategy": "suitability_advice"},
    {"id": "skincare_002", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "这个成分里有没有酒精？", "expected_strategy": "product_question"},
    {"id": "skincare_003", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "孕妇可以用吗？", "expected_strategy": "suitability_advice"},
    {"id": "skincare_004", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "这个会不会闷痘？我是油痘肌", "expected_strategy": "suitability_advice"},
    {"id": "skincare_005", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "早C晚A期间可以叠这个吗？", "expected_strategy": "suitability_advice"},
    {"id": "skincare_006", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "这款精华有烟酰胺吗？", "expected_strategy": "product_question"},
    {"id": "skincare_007", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "和理肤泉比哪个更适合敏感肌？", "expected_strategy": "comparison_request"},
    {"id": "skincare_008", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "多少钱？有试用装吗？", "expected_strategy": "purchase_request"},
    {"id": "skincare_009", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "这个这么贵，真的有必要买吗？", "expected_strategy": "objection_or_concern"},
    {"id": "skincare_010", "industry": "skincare", "platform": "xiaohongshu",
     "comment_text": "屏障受损可以用吗？最近脸很容易泛红", "expected_strategy": "suitability_advice"},

    # ── Makeup ───────────────────────────────────────────────────────────────
    {"id": "makeup_001", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "黄皮适合这个色号吗？会不会显黑？", "expected_strategy": "suitability_advice"},
    {"id": "makeup_002", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "这个口红是几号色？", "expected_strategy": "product_question"},
    {"id": "makeup_003", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "素颜涂会不会太突兀？", "expected_strategy": "suitability_advice"},
    {"id": "makeup_004", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "油皮用这个粉底会不会暗沉？", "expected_strategy": "suitability_advice"},
    {"id": "makeup_005", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "这个腮红是哑光还是带珠光？", "expected_strategy": "product_question"},
    {"id": "makeup_006", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "新手好上手吗？怕画脏", "expected_strategy": "suitability_advice"},
    {"id": "makeup_007", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "和完美日记比哪个好？", "expected_strategy": "comparison_request"},
    {"id": "makeup_008", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "有链接吗？想买这个色", "expected_strategy": "purchase_request"},
    {"id": "makeup_009", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "会不会显唇纹？我嘴唇比较干", "expected_strategy": "suitability_advice"},
    {"id": "makeup_010", "industry": "makeup", "platform": "xiaohongshu",
     "comment_text": "这个价格有点高，持妆真的好吗？", "expected_strategy": "objection_or_concern"},

    # ── Electronics ──────────────────────────────────────────────────────────
    {"id": "electronics_001", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "这个支持iPhone快充吗？", "expected_strategy": "product_question"},
    {"id": "electronics_002", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "多少瓦？可以充电脑吗？", "expected_strategy": "product_question"},
    {"id": "electronics_003", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "女生通勤背这个会不会太重？", "expected_strategy": "suitability_advice"},
    {"id": "electronics_004", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "有Type-C接口吗？", "expected_strategy": "product_question"},
    {"id": "electronics_005", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "和小米那个同价位的比哪个更值得？", "expected_strategy": "comparison_request"},
    {"id": "electronics_006", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "这个会不会发热很严重？", "expected_strategy": "objection_or_concern"},
    {"id": "electronics_007", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "保修多久？坏了怎么处理？", "expected_strategy": "product_question"},
    {"id": "electronics_008", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "有链接吗？想看下配置", "expected_strategy": "purchase_request"},
    {"id": "electronics_009", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "学生党买这个会不会太贵？", "expected_strategy": "objection_or_concern"},
    {"id": "electronics_010", "industry": "electronics", "platform": "xiaohongshu",
     "comment_text": "可以带上飞机吗？", "expected_strategy": "product_question"},

    # ── Household ────────────────────────────────────────────────────────────
    {"id": "household_001", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "这个锅可以用电磁炉吗？", "expected_strategy": "product_question"},
    {"id": "household_002", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "材质是不锈钢还是铝合金？", "expected_strategy": "product_question"},
    {"id": "household_003", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "小户型适合买吗？会不会占地方？", "expected_strategy": "suitability_advice"},
    {"id": "household_004", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "可以放洗碗机洗吗？", "expected_strategy": "product_question"},
    {"id": "household_005", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "这个会不会掉漆？", "expected_strategy": "objection_or_concern"},
    {"id": "household_006", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "和宜家类似款比哪个更稳？", "expected_strategy": "comparison_request"},
    {"id": "household_007", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "有几个尺寸？", "expected_strategy": "product_question"},
    {"id": "household_008", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "哪里买？有链接吗？", "expected_strategy": "purchase_request"},
    {"id": "household_009", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "家里有小孩用这个安全吗？", "expected_strategy": "suitability_advice"},
    {"id": "household_010", "industry": "household", "platform": "xiaohongshu",
     "comment_text": "这个价格有点贵，真的比普通款好用吗？", "expected_strategy": "objection_or_concern"},
]

# ---------------------------------------------------------------------------
# Brand + product context per industry
# ---------------------------------------------------------------------------

INDUSTRY_CONFIG = {
    "sunglasses": {
        "brand_name": "BONO",
        "brand_domain": "bonoshades.com",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "zh-CN",
        "brand_reply_profile": {
            "reply_principles": ["先回答框架/镜片相关问题，再引导了解更多", "不要承诺绝对显脸小"],
            "forbidden_phrases": ["绝对适合", "一定显瘦"],
            "diagnostic_factors": ["脸型", "鼻梁高低", "脸宽"],
        },
        "product_context": {
            "name": "BONO 猫眼框太阳镜",
            "category": "太阳镜",
            "features": ["UV400紫外线防护", "轻量TR90镜框", "多色可选：黑色/棕色/茶色"],
            "claims": ["UV400全防护", "重量仅25g", "适合多种脸型"],
            "not_claimed": ["偏光镜片", "防蓝光"],
            "unknowns": ["是否可配度数", "具体框宽尺寸数据"],
            "usage_notes": ["适合户外日常佩戴", "猫眼框型适合椭圆脸、长脸"],
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
        "product_context": {
            "name": "LUMIÈRE 修护精华",
            "category": "精华液",
            "ingredients_summary": ["透明质酸", "积雪草提取物", "神经酰胺"],
            "free_from": ["酒精", "香精", "矿物油"],
            "claims": ["无香精", "无酒精", "温和修护"],
            "not_claimed": ["孕期安全认证", "无防腐剂"],
            "unknowns": ["烟酰胺含量", "SPF防晒值"],
            "usage_notes": ["建议敏感肌先在耳后做测试", "与VC/VA叠用建议咨询皮肤科"],
        },
    },
    "makeup": {
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
        "product_context": {
            "name": "VELVET 丝绒哑光唇釉",
            "category": "唇釉",
            "shade": "01号 玫瑰裸粉 / 03号 深玫红",
            "finish": "哑光",
            "texture": "丝绒膏体，显色度高",
            "claims": ["哑光质地", "不易晕色"],
            "not_claimed": ["24小时持妆", "防水"],
            "unknowns": ["持妆时长具体数据"],
            "usage_notes": ["嘴唇干燥建议先打底润唇", "浅色号01适合黄皮/冷白皮"],
        },
    },
    "electronics": {
        "brand_name": "NOVA",
        "brand_domain": "novatech.com",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "zh-CN",
        "brand_reply_profile": {
            "reply_principles": ["直接回答规格参数问题", "不要夸大续航或性能"],
            "forbidden_phrases": ["行业最强", "无敌散热"],
            "diagnostic_factors": [],
        },
        "product_context": {
            "name": "NOVA 65W氮化镓充电器",
            "category": "充电器",
            "features": ["65W最大输出", "支持PD快充协议", "Type-C接口 x2 + USB-A x1",
                        "GaN氮化镓芯片", "重量98g"],
            "claims": ["兼容iPhone PD快充", "兼容MacBook Air/Pro（65W及以下）",
                      "支持国际电压100-240V"],
            "not_claimed": ["航空随身携带认证", "防水"],
            "unknowns": ["各国具体航空携带规定", "对所有笔记本型号的兼容性"],
            "usage_notes": ["充电发热属正常现象，表面温度<50°C安全范围内",
                           "飞机随身携带请提前确认航空公司规定"],
        },
    },
    "household": {
        "brand_name": "CRAFT",
        "brand_domain": "crafthome.com",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "preferred_language": "zh-CN",
        "brand_reply_profile": {
            "reply_principles": ["直接回答材质/兼容性问题", "不要承诺永久不掉漆"],
            "forbidden_phrases": ["永不生锈", "终身保固"],
            "diagnostic_factors": [],
        },
        "product_context": {
            "name": "CRAFT 铸铁搪瓷炖锅",
            "category": "炊具",
            "features": ["铸铁搪瓷涂层", "适用明火/电陶炉/燃气灶", "可入烤箱（上限230°C）"],
            "claims": ["不含PFOA/PTFE", "内外双层搪瓷涂层", "多色可选"],
            "not_claimed": ["可用电磁炉（底部非磁性）", "洗碗机安全"],
            "unknowns": ["具体尺寸重量数据（需确认型号）"],
            "usage_notes": ["搪瓷表面避免金属锅铲刮擦", "有小孩家庭建议选有安全把手版本",
                           "洗碗机高温可能损伤搪瓷涂层，建议手洗"],
        },
    },
}

# ---------------------------------------------------------------------------
# Mock DB
# ---------------------------------------------------------------------------

class _FakeQuery:
    def __init__(self, lead):
        self._lead = lead

    def filter(self, *args):
        return self

    def first(self):
        return self._lead


class _FakeDB:
    def __init__(self, lead):
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
# Knowledge entry builder
# ---------------------------------------------------------------------------

def _product_context_to_knowledge_entry(ctx: dict) -> dict:
    name = ctx.get("name") or "Product"
    lines = [f"Product facts for {name}:"]

    for key in ("category", "shade", "finish", "texture"):
        if ctx.get(key):
            lines.append(f"  {key}: {ctx[key]}")

    for key, label in [
        ("features", "Features"),
        ("ingredients_summary", "Ingredients"),
        ("free_from", "Free from"),
        ("claims", "Confirmed claims"),
        ("usage_notes", "Usage notes"),
    ]:
        vals = ctx.get(key)
        if vals:
            lines.append(f"  {label}: {', '.join(str(v) for v in vals)}")

    for key, label in [
        ("not_claimed", "NOT claimed (do not assert)"),
        ("unknowns", "Unknown (do not invent)"),
    ]:
        vals = ctx.get(key)
        if vals:
            lines.append(f"  {label}: {', '.join(str(v) for v in vals)}")

    return {
        "document_title": f"Product facts: {name}",
        "content": "\n".join(lines),
    }


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_all(llm: LLMClient) -> list[dict]:
    results = []
    total = len(EVAL_ITEMS)

    for i, item in enumerate(EVAL_ITEMS, 1):
        industry = item["industry"]
        config = INDUSTRY_CONFIG[industry]
        product_context = config["product_context"]
        knowledge_entry = _product_context_to_knowledge_entry(product_context)

        lead = _make_lead(platform=item["platform"])
        db = _FakeDB(lead)
        svc = DraftGenerationService(db, llm)

        brand_fields = {k: v for k, v in config.items() if k != "product_context"}
        owner_settings = {
            **brand_fields,
            "comment_text": item["comment_text"],
            "platform": item["platform"],
            "intent": None,
            "product_context": product_context,
            "knowledge_context": [knowledge_entry],
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
            "industry": industry,
            "comment_text": item["comment_text"],
            "expected_strategy": item["expected_strategy"],
            "actual_strategy": strategy,
            "strategy_match": match,
            "draft": draft,
        })

        tag = "✓" if match else "✗"
        sys.stderr.write(f"\r  [{i}/{total}] {tag} {item['id']}                    ")
        sys.stderr.flush()

    sys.stderr.write("\n")
    return results


# ---------------------------------------------------------------------------
# Markdown report
# ---------------------------------------------------------------------------

def write_markdown(results: list[dict], out_path: Path) -> None:
    by_industry: dict[str, list[dict]] = {}
    for r in results:
        by_industry.setdefault(r["industry"], []).append(r)

    total = len(results)
    matched = sum(1 for r in results if r["strategy_match"])

    lines = [
        "# P10.2 Extended Eval — Reply Quality Review",
        "",
        f"**Date:** 2026-05-24  |  **Branch:** `feature/evals-p102-cross-industry-routing`",
        "",
        "## Overall Summary",
        "",
        f"| Metric | Value |",
        f"|---|---|",
        f"| Total items | {total} |",
        f"| Strategy match | **{matched}/{total} ({matched*100//total}%)** |",
        f"| Strategy miss | {total - matched}/{total} |",
        "",
        "### Per-industry strategy match",
        "",
        "| Industry | Match | Total | % |",
        "|---|---|---|---|",
    ]

    for industry in ["sunglasses", "skincare", "makeup", "electronics", "household"]:
        items = by_industry.get(industry, [])
        m = sum(1 for r in items if r["strategy_match"])
        n = len(items)
        pct = f"{m*100//n}%" if n else "—"
        lines.append(f"| {industry} | {m} | {n} | {pct} |")

    lines += ["", "---", ""]

    for industry in ["sunglasses", "skincare", "makeup", "electronics", "household"]:
        items = by_industry.get(industry, [])
        if not items:
            continue
        config = INDUSTRY_CONFIG[industry]
        brand = config["brand_name"]
        m = sum(1 for r in items if r["strategy_match"])
        n = len(items)

        lines += [
            f"## {industry.title()} — {brand} ({m}/{n})",
            "",
        ]

        for r in items:
            match_icon = "✅" if r["strategy_match"] else "❌"
            strategy_note = (
                f"`{r['actual_strategy']}`"
                if r["strategy_match"]
                else f"`{r['actual_strategy']}` ← expected `{r['expected_strategy']}`"
            )
            lines += [
                f"### {r['id']} {match_icon}",
                "",
                f"**Comment:** {r['comment_text']}",
                "",
                f"**Strategy:** {strategy_note}",
                "",
                f"**Reply:**",
                "",
                f"> {r['draft'].replace(chr(10), '  ' + chr(10) + '> ')}",
                "",
                "---",
                "",
            ]

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[eval] Markdown written to {out_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="P10.2 extended eval runner")
    parser.add_argument("--out", help="Write JSON results to file")
    parser.add_argument("--md", help="Write markdown report to file",
                        default="eval_p102_extended.md")
    args = parser.parse_args()

    llm = LLMClient()
    print(f"[eval] Running {len(EVAL_ITEMS)} items across 5 industries ...")
    results = run_all(llm)

    matched = sum(1 for r in results if r["strategy_match"])
    print(f"[eval] Strategy match: {matched}/{len(results)}")

    misses = [r for r in results if not r["strategy_match"]]
    if misses:
        print(f"[eval] Misses ({len(misses)}):")
        for r in misses:
            print(f"  {r['id']}: got={r['actual_strategy']!r} expected={r['expected_strategy']!r}")

    if args.out:
        Path(args.out).write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[eval] JSON written to {args.out}")

    md_path = Path(args.md)
    write_markdown(results, md_path)


if __name__ == "__main__":
    main()
