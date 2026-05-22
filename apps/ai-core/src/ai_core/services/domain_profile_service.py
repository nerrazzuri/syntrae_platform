from __future__ import annotations

import copy
import re
from typing import Any


LIST_FIELDS = [
    "target_audience",
    "customer_concerns",
    "diagnostic_factors",
    "reply_principles",
    "purchase_triggers",
    "clarifying_questions",
    "forbidden_phrases",
    "forbidden_claims",
    "safety_notes",
]

DEFAULT_REPLY_PRINCIPLES = [
    "Answer the user's actual question before mentioning products.",
    "Do not force a product recommendation when the user is asking for advice.",
    "Use product information as support, not as a script.",
    "Avoid customer-service or hard-sell language.",
]

DEFAULT_FORBIDDEN_PHRASES = [
    "欢迎访问",
    "探索更多",
    "亲爱的用户",
    "亲爱的顾客",
    "感谢关注",
    "希望能帮助到你",
    "独特的感觉",
    "如有任何疑问",
    "please visit our store",
    "explore more options",
    "dear customer",
    "thank you for your interest",
]

DEFAULT_PURCHASE_TRIGGERS = [
    "哪里买",
    "有链接吗",
    "多少钱",
    "求链接",
    "where to buy",
    "how much",
    "link please",
    "mana beli",
    "harga berapa",
    "ada link",
]

DEFAULT_FORBIDDEN_CLAIMS = [
    "保证",
    "100%",
    "一定有效",
    "绝对安全",
    "适合所有人",
    "guaranteed",
    "suitable for all",
    "guaranteed result",
]

DEFAULT_CLARIFYING_QUESTIONS = [
    "方便的话可以补充一下你的使用场景吗？",
    "你更在意效果、价格，还是使用方便？",
]

DOMAIN_HINTS = {
    "sunglasses": {
        "aliases": [
            "sunglasses",
            "sunglass",
            "eyewear",
            "glasses",
            "shades",
            "墨镜",
            "太阳镜",
            "眼镜",
            "uv400",
            "偏光",
        ],
        "confidence": 0.85,
        "diagnostic_factors": ["镜框宽度", "镜片大小", "上扬角度", "鼻梁贴合度", "脸型比例", "穿搭风格"],
        "customer_concerns": ["显脸大", "低鼻梁", "压鼻梁", "不适合脸型", "拍照不自然"],
        "reply_principles": ["先判断款式比例，再给选款建议。", "不要制造外貌焦虑。"],
        "forbidden_claims": ["保证显脸小", "100%适合所有脸型"],
    },
    "skincare": {
        "aliases": [
            "skincare",
            "serum",
            "cream",
            "toner",
            "acne",
            "sensitive skin",
            "护肤",
            "精华",
            "面霜",
            "爽肤水",
            "敏感肌",
            "痘痘",
            "酸类",
        ],
        "confidence": 0.85,
        "diagnostic_factors": ["肤质", "敏感程度", "使用频率", "成分刺激性", "过往反应"],
        "customer_concerns": ["泛红", "过敏", "刺激", "爆痘", "没效果"],
        "reply_principles": ["安全类问题先保守建议，不要保证效果。", "建议先局部测试或低频使用。"],
        "forbidden_claims": ["一定有效", "适合所有肤质", "绝对安全", "包治"],
    },
    "pet_supplies": {
        "aliases": [
            "pet",
            "cat",
            "dog",
            "kitten",
            "puppy",
            "宠物",
            "猫",
            "狗",
            "小猫",
            "幼猫",
            "幼犬",
            "肠胃",
        ],
        "confidence": 0.85,
        "diagnostic_factors": ["宠物年龄", "体重", "肠胃状态", "喂食量", "过往反应"],
        "customer_concerns": ["肠胃敏感", "挑食", "安全性", "适口性"],
        "reply_principles": ["宠物食用/安全问题不要绝对保证。", "建议少量尝试并观察反应。"],
        "forbidden_claims": ["一定没问题", "绝对安全", "包治"],
        "safety_notes": ["宠物食用相关问题建议少量尝试，并观察便便和精神状态。"],
    },
    "electronics": {
        "aliases": [
            "laptop",
            "charger",
            "phone",
            "usb",
            "cable",
            "power",
            "电脑",
            "充电器",
            "手机",
            "接口",
            "电源",
            "兼容",
            "支持",
        ],
        "confidence": 0.8,
        "diagnostic_factors": ["设备型号", "接口规格", "功率/电压", "系统兼容性", "使用场景"],
        "customer_concerns": ["兼容性", "安全性", "发热", "功率不足"],
        "reply_principles": ["先确认规格和兼容性，再建议购买。", "不确定时不要保证兼容。"],
        "forbidden_claims": ["100%兼容", "绝对安全"],
    },
    "saas": {
        "aliases": [
            "saas",
            "software",
            "app",
            "automation",
            "crm",
            "team",
            "dashboard",
            "软件",
            "系统",
            "自动化",
            "团队",
            "小团队",
            "工作流",
        ],
        "confidence": 0.8,
        "diagnostic_factors": ["团队规模", "使用场景", "当前流程", "上手成本", "集成需求"],
        "customer_concerns": ["太复杂", "成本", "学习成本", "效果不确定"],
        "reply_principles": ["先确认使用场景和团队规模。", "不要一开始承诺全面自动化。"],
        "forbidden_claims": ["保证增长", "100%自动化", "一定有效"],
    },
    "local_service": {
        "aliases": [
            "service",
            "appointment",
            "booking",
            "repair",
            "beauty",
            "cleaning",
            "服务",
            "预约",
            "上门",
            "维修",
            "美容",
            "清洁",
        ],
        "confidence": 0.75,
        "diagnostic_factors": ["服务区域", "时间安排", "预算", "具体需求"],
        "customer_concerns": ["价格", "可信度", "时间", "服务质量"],
        "reply_principles": ["先确认需求和地区，再引导预约。"],
        "forbidden_claims": ["绝对满意", "最便宜"],
    },
    "fashion": {
        "aliases": [
            "fashion",
            "outfit",
            "dress",
            "shirt",
            "style",
            "穿搭",
            "衣服",
            "裙子",
            "上衣",
            "风格",
        ],
        "confidence": 0.75,
        "diagnostic_factors": ["身形比例", "穿搭风格", "使用场景", "尺码"],
        "customer_concerns": ["显胖", "不适合", "尺码不准"],
        "reply_principles": ["先判断搭配/版型，再给建议。", "不要制造身材焦虑。"],
    },
    "food_beverage": {
        "aliases": [
            "food",
            "drink",
            "coffee",
            "snack",
            "食品",
            "饮料",
            "咖啡",
            "零食",
            "口味",
        ],
        "confidence": 0.75,
        "diagnostic_factors": ["口味偏好", "过敏源", "食用场景", "甜度/辣度"],
        "customer_concerns": ["口味", "过敏", "健康", "价格"],
        "forbidden_claims": ["绝对健康", "包治", "100%安全"],
    },
}

KNOWLEDGE_HINTS = [
    {
        "patterns": ["safety", "安全"],
        "safety_notes": ["安全相关回复要保守，不要绝对保证。"],
        "forbidden_claims": ["绝对安全", "100% safe"],
    },
    {
        "patterns": ["warranty", "保修", "return", "退换", "refund"],
        "safety_notes": ["售后、保修和退换信息只能按已知政策说明。"],
    },
    {
        "patterns": ["allergy", "allergic", "过敏", "敏感"],
        "diagnostic_factors": ["过敏史", "过往反应"],
        "safety_notes": ["过敏/敏感问题建议先小范围测试或咨询专业人士。"],
        "forbidden_claims": ["不会过敏", "绝对安全"],
    },
    {
        "patterns": ["uv400", "偏光"],
        "diagnostic_factors": ["UV防护", "镜片功能"],
    },
    {
        "patterns": ["size", "尺寸", "尺码"],
        "diagnostic_factors": ["尺寸", "尺码", "贴合度"],
    },
    {
        "patterns": ["compatibility", "compatible", "兼容", "支持"],
        "diagnostic_factors": ["兼容性", "设备型号", "系统版本"],
        "forbidden_claims": ["100%兼容"],
    },
]


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", _normalize_text(value).lower())


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, tuple):
        raw_values = list(value)
    elif isinstance(value, str):
        raw_values = [value]
    else:
        raw_values = [str(value)]

    result = []
    for item in raw_values:
        if not isinstance(item, str):
            item = str(item)
        stripped = item.strip()
        if stripped:
            result.append(stripped)
    return result


def _dedupe(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        for item in _as_list(value):
            key = item.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
    return result


def _has_meaningful_profile(profile: dict | None) -> bool:
    if not isinstance(profile, dict) or not profile:
        return False
    for value in profile.values():
        if isinstance(value, list) and any(_as_list(value)):
            return True
        if isinstance(value, str) and value.strip():
            return True
        if isinstance(value, (int, float)):
            return True
    return False


def _base_profile() -> dict[str, Any]:
    return {
        "version": 1,
        "source": "auto_derived",
        "domain_label": "generic",
        "domain_confidence": 0.3,
        "target_audience": [],
        "customer_concerns": [],
        "diagnostic_factors": [],
        "reply_principles": list(DEFAULT_REPLY_PRINCIPLES),
        "purchase_triggers": list(DEFAULT_PURCHASE_TRIGGERS),
        "clarifying_questions": list(DEFAULT_CLARIFYING_QUESTIONS),
        "forbidden_phrases": list(DEFAULT_FORBIDDEN_PHRASES),
        "forbidden_claims": list(DEFAULT_FORBIDDEN_CLAIMS),
        "safety_notes": [],
    }


def _source_text(
    brand_domain: str | None,
    product_context: dict | None,
    knowledge_context: list | None,
) -> str:
    values: list[str] = [_normalize_text(brand_domain)]
    if isinstance(product_context, dict):
        for key in (
            "name",
            "category",
            "description",
            "target_buyer",
            "price_label",
            "cta_url",
        ):
            values.extend(_as_list(product_context.get(key)))
        values.extend(_as_list(product_context.get("key_benefits")))
        values.extend(_as_list(product_context.get("common_objections")))

    if isinstance(knowledge_context, list):
        for item in knowledge_context[:3]:
            if not isinstance(item, dict):
                continue
            values.extend(_as_list(item.get("document_title")))
            values.extend(_as_list(item.get("content")))

    return _compact_text(" ".join(values))


def _contains_any(source: str, patterns: list[str]) -> bool:
    return any(_compact_text(pattern) in source for pattern in patterns)


def infer_domain_label(
    brand_domain: str | None,
    product_context: dict | None,
    knowledge_context: list | None,
) -> tuple[str, float]:
    source = _source_text(brand_domain, product_context, knowledge_context)
    for label, hints in DOMAIN_HINTS.items():
        if _contains_any(source, hints.get("aliases", [])):
            return label, float(hints.get("confidence", 0.75))

    if _normalize_text(brand_domain):
        return _normalize_text(brand_domain), 0.3
    return "generic", 0.3


def _merge_lists(profile: dict[str, Any], updates: dict[str, Any]) -> None:
    for field in LIST_FIELDS:
        profile[field] = _dedupe(
            list(profile.get(field) or []) + _as_list(updates.get(field))
        )


def _apply_domain_hints(profile: dict[str, Any], domain_label: str) -> None:
    hints = DOMAIN_HINTS.get(domain_label)
    if hints:
        _merge_lists(profile, hints)


def _apply_product_context(
    profile: dict[str, Any], product_context: dict | None
) -> None:
    if not isinstance(product_context, dict):
        return

    updates: dict[str, Any] = {
        "target_audience": _as_list(product_context.get("target_buyer")),
        "customer_concerns": _as_list(product_context.get("common_objections")),
    }
    if product_context.get("price_label"):
        updates["purchase_triggers"] = ["价格", "how much"]
    if product_context.get("cta_url"):
        updates["purchase_triggers"] = list(updates.get("purchase_triggers", [])) + [
            "有链接吗",
            "link please",
        ]

    _merge_lists(profile, updates)


def _apply_knowledge_context(
    profile: dict[str, Any],
    knowledge_context: list | None,
) -> None:
    if not isinstance(knowledge_context, list):
        return

    source = _source_text(None, None, knowledge_context[:3])
    for hint in KNOWLEDGE_HINTS:
        if _contains_any(source, hint.get("patterns", [])):
            _merge_lists(profile, hint)


def _owner_setting_lists(owner_settings: dict | None) -> dict[str, Any]:
    if not isinstance(owner_settings, dict):
        return {}
    updates = {field: owner_settings.get(field) for field in LIST_FIELDS}
    tone = _normalize_text(owner_settings.get("tone"))
    if tone:
        updates["reply_principles"] = _as_list(updates.get("reply_principles")) + [
            f"Match the configured tone: {tone}."
        ]
    return updates


def _normalize_existing_profile(existing_profile: dict | None) -> dict[str, Any]:
    if not isinstance(existing_profile, dict):
        return {}
    copied = copy.deepcopy(existing_profile)
    normalized: dict[str, Any] = {}
    for field in LIST_FIELDS:
        normalized[field] = _as_list(copied.get(field))
    for key in ("domain_label", "domain_confidence"):
        if key in copied:
            normalized[key] = copied[key]
    return normalized


def build_brand_reply_profile(
    *,
    brand_name: str | None = None,
    brand_domain: str | None = None,
    product_context: dict | None = None,
    knowledge_context: list | None = None,
    existing_profile: dict | None = None,
    owner_settings: dict | None = None,
) -> dict:
    del brand_name

    profile = _base_profile()
    if not _normalize_text(brand_domain) and isinstance(owner_settings, dict):
        brand_domain = owner_settings.get("brand_domain")
    normalized_existing = _normalize_existing_profile(existing_profile)
    has_existing_profile = _has_meaningful_profile(normalized_existing)
    inferred_domain, inferred_confidence = infer_domain_label(
        brand_domain,
        product_context,
        knowledge_context,
    )

    profile["domain_label"] = inferred_domain
    profile["domain_confidence"] = inferred_confidence

    _apply_domain_hints(profile, inferred_domain)
    _apply_product_context(profile, product_context)
    _apply_knowledge_context(profile, knowledge_context)
    _merge_lists(profile, _owner_setting_lists(owner_settings))
    _merge_lists(profile, normalized_existing)

    existing_domain_label = _normalize_text(normalized_existing.get("domain_label"))
    if existing_domain_label:
        profile["domain_label"] = existing_domain_label

    try:
        existing_confidence = float(normalized_existing.get("domain_confidence", 0))
    except (TypeError, ValueError):
        existing_confidence = 0.0
    profile["domain_confidence"] = max(
        float(profile["domain_confidence"]), existing_confidence
    )
    profile["source"] = "merged" if has_existing_profile else "auto_derived"

    for field in LIST_FIELDS:
        profile[field] = _dedupe(profile.get(field) or [])
    profile["version"] = 1
    return profile
