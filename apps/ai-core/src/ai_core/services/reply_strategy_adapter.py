from __future__ import annotations

import re
from typing import Any


GLOBAL_FORBIDDEN_PHRASES = [
    "欢迎访问",
    "探索更多",
    "亲爱的用户",
    "亲爱的顾客",
    "感谢关注",
    "希望能帮助到你",
    "独特的感觉",
    "如有任何疑问",
    "请随时联系",
    "竭诚为您",
    "我们致力于",
    "作为一个品牌",
    "please visit our store",
    "explore more options",
    "dear customer",
    "feel free to contact us",
]

PURCHASE_KEYWORDS = [
    "哪里买",
    "有链接吗",
    "多少钱",
    "求链接",
    "link",
    "price",
]

SUITABILITY_KEYWORDS = [
    "适合我吗",
    "可以用吗",
    "能吃吗",
    "脸型",
    "敏感肌",
    "小猫",
    "会不会",
]

COMPARISON_KEYWORDS = ["哪个好", "对比", "compare", "a和b"]
USAGE_KEYWORDS = ["怎么用", "怎么搭", "怎么安装"]
OBJECTION_KEYWORDS = ["太贵", "怕踩雷", "没效果", "担心"]
COMPLAINT_KEYWORDS = ["不好看", "没用", "后悔", "投诉"]
COMPLIMENT_KEYWORDS = ["好看", "种草", "喜欢", "nice"]


def _normalize_text(value: str | None) -> str:
    return re.sub(r"[\s_-]+", "", str(value or "").strip().lower())


def _contains_any(text: str | None, keywords: list[str]) -> bool:
    normalized = _normalize_text(text)
    return any(_normalize_text(keyword) in normalized for keyword in keywords)


def _dedupe(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        phrase = value.strip()
        if not phrase:
            continue
        key = phrase.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(phrase)
    return result


def _list_from_dict(value: dict | None, key: str) -> list[str]:
    if not isinstance(value, dict):
        return []
    raw = value.get(key)
    return raw if isinstance(raw, list) else []


def _buyer_stage_is_weak(buyer_stage: str | None) -> bool:
    normalized = _normalize_text(buyer_stage)
    return normalized in {"", "unknown", "awareness", "low", "weak"}


def _confidence_is_low(confidence: float | None) -> bool:
    if confidence is None:
        return False
    try:
        return float(confidence) < 0.45
    except (TypeError, ValueError):
        return False


def _map_intent(intent: str | None, confidence: float | None) -> tuple[str, bool]:
    normalized = _normalize_text(intent)
    if not normalized:
        return "general_interest", True

    if "fitsuitability" in normalized or "suitability" in normalized:
        return "suitability_advice", False
    if "productinquiry" in normalized or "productquestion" in normalized:
        return "product_question", False
    if "problemsolution" in normalized or "usage" in normalized:
        return "usage_advice", False
    if (
        "priceinquiry" in normalized
        or "purchaseintent" in normalized
        or "linkrequest" in normalized
        or "latentpurchase" in normalized
    ):
        return "purchase_request", False
    if "costbenefithesitation" in normalized or "objection" in normalized:
        return "objection_or_concern", False
    if "postpurchaseregret" in normalized or "complaint" in normalized:
        return "complaint_or_negative", False
    if "comparison" in normalized or "compare" in normalized:
        return "comparison_request", False
    if "noise" in normalized:
        return "irrelevant_or_low_value", False
    if "unknown" in normalized:
        return (
            "irrelevant_or_low_value"
            if _confidence_is_low(confidence)
            else "general_interest",
            True,
        )
    return "general_interest", True


def _fallback_reply_intent(comment_text: str | None) -> str | None:
    if _contains_any(comment_text, PURCHASE_KEYWORDS):
        return "purchase_request"
    if _contains_any(comment_text, SUITABILITY_KEYWORDS):
        return "suitability_advice"
    if _contains_any(comment_text, COMPARISON_KEYWORDS):
        return "comparison_request"
    if _contains_any(comment_text, USAGE_KEYWORDS):
        return "usage_advice"
    if _contains_any(comment_text, OBJECTION_KEYWORDS):
        return "objection_or_concern"
    if _contains_any(comment_text, COMPLAINT_KEYWORDS):
        return "complaint_or_negative"
    if _contains_any(comment_text, COMPLIMENT_KEYWORDS):
        return "compliment_or_interest"
    return None


def _cta_strength(owner_settings: dict | None) -> str:
    style = _normalize_text(
        owner_settings.get("reply_cta_style")
        if isinstance(owner_settings, dict)
        else None
    )
    return "direct" if style in {"direct", "aggressive", "hard"} else "soft"


def _suggested_focus(
    reply_intent: str,
    brand_reply_profile: dict | None,
) -> str:
    factors = _list_from_dict(brand_reply_profile, "diagnostic_factors")
    if factors:
        return "Use these diagnostic factors when relevant: " + ", ".join(factors)

    focus_by_intent = {
        "suitability_advice": "Give a concrete diagnosis or judgment first, then one practical suggestion.",
        "product_question": "Answer the exact product question before any light redirect.",
        "purchase_request": "Answer the buying/link/price request directly with a soft next step.",
        "comparison_request": "Compare the options with one clear deciding factor.",
        "usage_advice": "Give short, actionable usage guidance.",
        "objection_or_concern": "Validate the concern and reduce risk without hard selling.",
        "complaint_or_negative": "Acknowledge the negative experience and offer a repair path.",
        "compliment_or_interest": "Keep it light and human; do not over-sell.",
        "irrelevant_or_low_value": "Keep the reply minimal or skip when appropriate.",
        "general_interest": "Respond naturally to the comment without forcing a CTA.",
    }
    return focus_by_intent.get(reply_intent, focus_by_intent["general_interest"])


def _base_strategy(reply_intent: str, owner_settings: dict | None) -> dict[str, Any]:
    strategy: dict[str, Any] = {
        "reply_intent": reply_intent,
        "reply_mode": "light_engagement",
        "should_redirect": False,
        "cta_strength": "none",
        "require_diagnostic": False,
        "require_specific_answer": False,
        "risk_flags": [],
    }

    if reply_intent == "purchase_request":
        strategy.update(
            reply_mode="answer_then_soft_cta",
            should_redirect=True,
            cta_strength=_cta_strength(owner_settings),
            require_specific_answer=True,
        )
    elif reply_intent == "suitability_advice":
        strategy.update(
            reply_mode="advisor_diagnostic",
            require_diagnostic=True,
            require_specific_answer=True,
        )
    elif reply_intent == "product_question":
        strategy.update(
            reply_mode="answer_first",
            should_redirect=True,
            cta_strength="soft",
            require_specific_answer=True,
        )
    elif reply_intent == "usage_advice":
        strategy.update(
            reply_mode="advisor_instruction",
            require_specific_answer=True,
        )
    elif reply_intent == "objection_or_concern":
        strategy.update(
            reply_mode="reassure_then_clarify",
            require_specific_answer=True,
        )
    elif reply_intent == "complaint_or_negative":
        strategy.update(
            reply_mode="acknowledge_repair",
            require_specific_answer=True,
            risk_flags=["NEGATIVE_OR_COMPLAINT"],
        )
    elif reply_intent == "irrelevant_or_low_value":
        strategy.update(
            reply_mode="minimal_or_skip",
            risk_flags=["LOW_VALUE_COMMENT"],
        )
    elif reply_intent == "comparison_request":
        strategy.update(
            reply_mode="compare_then_recommend",
            require_specific_answer=True,
        )

    return strategy


def adapt_reply_strategy(
    intent: str | None,
    buyer_stage: str | None,
    confidence: float | None,
    risk_level: str | None,
    platform: str | None,
    comment_text: str | None,
    product_context: dict | None = None,
    brand_reply_profile: dict | None = None,
    owner_settings: dict | None = None,
) -> dict:
    del platform, product_context

    reply_intent, can_fallback = _map_intent(intent, confidence)
    if can_fallback and _buyer_stage_is_weak(buyer_stage):
        reply_intent = _fallback_reply_intent(comment_text) or reply_intent

    if reply_intent in {"product_question", "general_interest"} and _contains_any(
        comment_text, PURCHASE_KEYWORDS
    ):
        reply_intent = "purchase_request"

    strategy = _base_strategy(reply_intent, owner_settings)

    risk_flags = list(strategy.get("risk_flags", []))
    if _normalize_text(risk_level) in {"high", "critical"}:
        risk_flags.append("HIGH_RISK")

    forbidden_phrases = _dedupe(
        GLOBAL_FORBIDDEN_PHRASES
        + _list_from_dict(owner_settings, "forbidden_phrases")
        + _list_from_dict(brand_reply_profile, "forbidden_phrases")
    )

    return {
        **strategy,
        "forbidden_phrases": forbidden_phrases,
        "risk_flags": _dedupe(risk_flags),
        "suggested_focus": _suggested_focus(reply_intent, brand_reply_profile),
    }
