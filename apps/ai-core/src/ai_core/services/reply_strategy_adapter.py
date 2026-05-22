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

PURCHASE_PATTERNS = [
    "哪里买",
    "有链接吗",
    "多少钱",
    "求链接",
    "怎么买",
    "价格多少",
    "where to buy",
    "where can i buy",
    "link please",
    "how much",
    "buy link",
    "where do i get",
    "mana beli",
    "boleh beli",
    "harga berapa",
    "berapa harga",
    "link ada",
    "ada link",
    "berapa",
    "beli mana",
    "price",
]

PURCHASE_KEYWORDS = PURCHASE_PATTERNS

COMPARISON_PATTERNS = [
    "哪个好",
    "哪个更好",
    "对比",
    "比较",
    "a和b",
    "which is better",
    "compare",
    "comparison",
    "vs",
    "difference between",
    "mana lagi bagus",
    "mana lebih bagus",
    "banding",
    "dibanding",
    "beza",
    "bedanya",
    "lebih baik",
]

USAGE_PATTERNS = [
    "怎么用",
    "怎么搭",
    "怎么安装",
    "怎么设置",
    "怎么接",
    "怎么连接",
    "怎么吃",
    "怎么穿",
    "怎么操作",
    "how to use",
    "how do i use",
    "how to install",
    "how to set up",
    "how to connect",
    "how to link",
    "how to wear",
    "how to apply",
    "cara guna",
    "macam mana guna",
    "cara pakai",
    "cara install",
    "cara pasang",
    "cara sambung",
    "cara menggunakan",
    "gimana pakai",
    "gimana cara",
    "cara connect",
]

SUITABILITY_PATTERNS = [
    "适不适合",
    "适合我吗",
    "适合吗",
    "适合新手",
    "适合小白",
    "新手可以",
    "小白可以",
    "小孩可以",
    "孩子可以",
    "孕妇可以",
    "老人可以",
    "家用可以",
    "家用适合",
    "小团队适合",
    "小店适合",
    "公司适合",
    "工厂适合",
    "会不会适合",
    "会不会不适合",
    "suit me",
    "suitable for me",
    "is it suitable",
    "good for beginners",
    "beginner friendly",
    "good for newbie",
    "suitable for beginners",
    "suitable for small team",
    "suitable for home use",
    "can beginners use",
    "can kids use",
    "can pregnant women use",
    "sesuai untuk saya",
    "sesuai tak",
    "sesuai ke",
    "sesuai untuk beginner",
    "sesuai untuk pemula",
    "sesuai untuk budak",
    "sesuai untuk ibu mengandung",
    "sesuai untuk rumah",
    "sesuai untuk team kecil",
    "beginner boleh guna",
    "budak boleh guna",
    "cocok untuk saya",
    "cocok gak",
    "cocok nggak",
    "cocok untuk pemula",
    "cocok untuk anak",
    "cocok untuk ibu hamil",
    "cocok untuk rumah",
    "cocok untuk tim kecil",
    "pemula bisa pakai",
    "anak bisa pakai",
]

COMPATIBILITY_PATTERNS = [
    "支持吗",
    "兼容吗",
    "可以接",
    "能接",
    "可以连",
    "能连",
    "可以连接",
    "能连接",
    "可以安装",
    "能安装",
    "可以装",
    "能装",
    "可以跑",
    "能跑",
    "能不能用",
    "可不可以用",
    "可以用吗",
    "能用吗",
    "does it support",
    "is it compatible with",
    "compatible with",
    "does it work with",
    "does this work with",
    "work with",
    "can it connect",
    "can connect to",
    "can i link",
    "link this with",
    "link with",
    "can install",
    "can be installed",
    "can run on",
    "does it fit",
    "will it fit",
    "support mac",
    "support android",
    "support iphone",
    "support tak",
    "compatible dengan",
    "sesuai dengan",
    "boleh connect",
    "boleh sambung",
    "boleh pasang",
    "boleh install",
    "boleh guna dengan",
    "boleh pakai dengan",
    "support gak",
    "support nggak",
    "kompatibel dengan",
    "bisa connect",
    "bisa sambung",
    "bisa dipasang",
    "bisa install",
    "bisa dipakai dengan",
    "bisa digunakan dengan",
]

SAFETY_SUITABILITY_PATTERNS = [
    "能不能吃",
    "可以吃吗",
    "能吃吗",
    "安全吗",
    "有没有副作用",
    "会不会过敏",
    "会不会刺激",
    "会不会不舒服",
    "会不会伤",
    "孕妇可以用吗",
    "小孩可以用吗",
    "宝宝可以用吗",
    "宠物可以吃吗",
    "猫可以吃吗",
    "狗可以吃吗",
    "敏感肌可以用吗",
    "is it safe",
    "safe for",
    "any side effects",
    "allergic",
    "allergy",
    "irritation",
    "safe for kids",
    "safe for baby",
    "safe for pregnant",
    "safe for pets",
    "can pets eat",
    "can cats eat",
    "can dogs eat",
    "good for sensitive skin",
    "selamat tak",
    "selamat untuk",
    "ada side effect",
    "alergi",
    "iritasi",
    "sesuai untuk kulit sensitif",
    "budak boleh makan",
    "bayi boleh guna",
    "ibu mengandung boleh guna",
    "kucing boleh makan",
    "anjing boleh makan",
    "aman gak",
    "aman nggak",
    "aman untuk",
    "ada efek samping",
    "cocok untuk kulit sensitif",
    "anak boleh makan",
    "bayi bisa pakai",
    "ibu hamil bisa pakai",
    "kucing bisa makan",
    "anjing bisa makan",
]

WEAK_SUITABILITY_PATTERNS = [
    "可以吗",
    "行吗",
    "能行吗",
    "合适吗",
    "适配吗",
]

CONCERN_PATTERNS = [
    "会不会很贵",
    "会不会太贵",
    "会不会很难",
    "会不会难",
    "会不会麻烦",
    "会不会掉色",
    "会不会坏",
    "会不会踩雷",
    "会不会被骗",
    "会不会没效果",
    "怕踩雷",
    "担心",
    "太贵",
    "没效果",
    "too expensive",
    "is it expensive",
    "will it be expensive",
    "is it hard",
    "will it be hard",
    "worried",
    "worry",
    "does it really work",
    "afraid it won't work",
    "scared it won't work",
    "hard to use",
    "difficult to install",
    "mahal tak",
    "mahal ke",
    "susah tak",
    "susah guna",
    "risau",
    "takut tak sesuai",
    "berkesan tak",
    "takut tak jadi",
    "takut tak berkesan",
    "mahal gak",
    "mahal nggak",
    "susah gak",
    "susah nggak",
    "khawatir",
    "takut gak cocok",
    "takut nggak cocok",
    "efektif gak",
    "takut gak berhasil",
    "takut nggak berhasil",
]

COMPLAINT_PATTERNS = [
    "不好看",
    "不好用",
    "没用",
    "后悔",
    "投诉",
    "翻车",
    "差评",
    "disappointed",
    "regret buying",
    "not good",
    "doesn't work",
    "did not work",
    "bad experience",
    "menyesal beli",
    "tak bagus",
    "gak bagus",
    "nggak bagus",
    "tidak bagus",
    "tak berfungsi",
    "tidak berfungsi",
    "kecewa",
]

COMPLIMENT_PATTERNS = [
    "好看",
    "可爱",
    "种草",
    "喜欢",
    "nice",
    "cute",
    "love it",
    "looks good",
    "so pretty",
    "cantik",
    "comel",
    "suka",
    "bagus",
    "keren",
    "lucu",
]

PRODUCT_GROUNDING_MODE_BY_INTENT = {
    "purchase_request": "product_first",
    "product_question": "answer_from_product",
    "suitability_advice": "diagnostic_then_product_support",
    "usage_advice": "instruction_then_product_support",
    "objection_or_concern": "concern_first_product_support",
    "complaint_or_negative": "repair_first_no_sell",
    "compliment_or_interest": "light_optional",
    "general_interest": "light_optional",
    "irrelevant_or_low_value": "none",
    "comparison_request": "answer_from_product",
}

# Core vs domain fallback boundary:
# - Core fallback detects generic intent patterns such as purchase, suitability,
#   comparison, usage, objection, complaint, or light interest.
# - Core fallback should not become a growing hardcoded industry keyword list.
# - Domain/product terms may support fallback only when combined with generic
#   intent language. Those terms should come from brand_reply_profile or
#   product_context and eventually from domain_context/profile services.


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


def _append_text_values(values: list[str], raw: Any) -> None:
    if isinstance(raw, str):
        values.append(raw)
    elif isinstance(raw, list):
        values.extend(item for item in raw if isinstance(item, str))


def _domain_terms(
    product_context: dict | None,
    brand_reply_profile: dict | None,
) -> list[str]:
    terms: list[str] = []
    for key in ("diagnostic_factors", "customer_concerns"):
        terms.extend(_list_from_dict(brand_reply_profile, key))

    if isinstance(product_context, dict):
        for key in ("category", "target_buyer"):
            _append_text_values(terms, product_context.get(key))

    return _dedupe([term for term in terms if len(_normalize_text(term)) >= 2])


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


def _has_domain_assisted_suitability(
    comment_text: str | None,
    product_context: dict | None,
    brand_reply_profile: dict | None,
) -> bool:
    return _contains_any(comment_text, WEAK_SUITABILITY_PATTERNS) and _contains_any(
        comment_text,
        _domain_terms(product_context, brand_reply_profile),
    )


def _fallback_reply_intent(
    comment_text: str | None,
    product_context: dict | None = None,
    brand_reply_profile: dict | None = None,
) -> tuple[str | None, list[str]]:
    if _contains_any(comment_text, PURCHASE_PATTERNS):
        return "purchase_request", []
    if _contains_any(comment_text, COMPARISON_PATTERNS):
        return "comparison_request", []
    if _contains_any(comment_text, COMPLAINT_PATTERNS):
        return "complaint_or_negative", []
    if _contains_any(comment_text, CONCERN_PATTERNS):
        return "objection_or_concern", []
    if _contains_any(comment_text, SAFETY_SUITABILITY_PATTERNS):
        return "suitability_advice", ["SAFETY_SUITABILITY"]
    if _contains_any(
        comment_text, SUITABILITY_PATTERNS
    ) or _has_domain_assisted_suitability(
        comment_text,
        product_context,
        brand_reply_profile,
    ):
        return "suitability_advice", []
    if _contains_any(comment_text, COMPATIBILITY_PATTERNS):
        return "product_question", []
    if _contains_any(comment_text, USAGE_PATTERNS):
        return "usage_advice", []
    if _contains_any(comment_text, COMPLIMENT_PATTERNS):
        return "compliment_or_interest", []
    return None, []


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


def _product_grounding_mode(reply_intent: str) -> str:
    return PRODUCT_GROUNDING_MODE_BY_INTENT.get(reply_intent, "light_optional")


def _base_strategy(reply_intent: str, owner_settings: dict | None) -> dict[str, Any]:
    strategy: dict[str, Any] = {
        "reply_intent": reply_intent,
        "reply_mode": "light_engagement",
        "should_redirect": False,
        "cta_strength": "none",
        "require_diagnostic": False,
        "require_specific_answer": False,
        "product_grounding_mode": _product_grounding_mode(reply_intent),
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
    del platform

    reply_intent, can_fallback = _map_intent(intent, confidence)
    fallback_risk_flags: list[str] = []
    if can_fallback and _buyer_stage_is_weak(buyer_stage):
        fallback_intent, fallback_risk_flags = _fallback_reply_intent(
            comment_text,
            product_context=product_context,
            brand_reply_profile=brand_reply_profile,
        )
        reply_intent = fallback_intent or reply_intent

    if reply_intent in {"product_question", "general_interest"} and _contains_any(
        comment_text, PURCHASE_PATTERNS
    ):
        reply_intent = "purchase_request"

    strategy = _base_strategy(reply_intent, owner_settings)

    risk_flags = list(strategy.get("risk_flags", [])) + fallback_risk_flags
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
