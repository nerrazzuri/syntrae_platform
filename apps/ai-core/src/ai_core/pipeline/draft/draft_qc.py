from __future__ import annotations

import re
from typing import Any


UNIVERSAL_AI_SMELL_PHRASES = [
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
    "thank you for your interest",
    "please visit our store",
    "explore more options",
    "dear customer",
    "feel free to contact us",
]

CTA_PHRASES = [
    "进店",
    "店铺",
    "主页有链接",
    "点主页",
    "链接在主页",
    "欢迎购买",
    "下单",
    "私信",
    "dm",
    "visit our store",
    "link in bio",
    "buy now",
    "order now",
]

HARD_SELL_PHRASES = [
    "立即购买",
    "限时优惠",
    "仅剩",
    "马上下单",
    "best",
    "cheapest",
    "100%",
]

UNSAFE_CLAIM_PHRASES = [
    "guarantee",
    "guaranteed",
    "包治",
    "一定有效",
    "绝对安全",
    "适合所有人",
    "suitable for all",
    "guaranteed result",
]

TRIVIAL_REPLY_PATTERNS = [
    "可以哦",
    "试试看哦",
    "不错哦",
    "可以试试看哦",
    "可以试试哦",
    "可以试试看",
]

DIAGNOSTIC_FALLBACK_TERMS = [
    "因为",
    "主要是",
    "可能是",
    "看起来",
    "原因",
    "比例",
    "适合",
    "不太适合",
    "建议",
    "试试",
    "because",
    "mainly",
    "likely",
    "looks like",
    "reason",
    "fit",
    "suitable",
    "suggest",
    "try",
]

BLOCKING_FLAG_TYPES = {
    "EMPTY_REPLY",
    "BANNED_PHRASE",
    "AI_TONE",
    "CTA_VIOLATION",
    "HARD_SELL",
    "UNSAFE_CLAIM",
    "MISSING_DIAGNOSTIC",
}


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip().lower()


def _compact_text(value: str | None) -> str:
    return re.sub(r"[\s，。！？!?、,.~～：:；;\"'“”‘’「」『』（）()]+", "", _normalize_text(value))


def _list_from_dict(value: dict | None, key: str) -> list[str]:
    if not isinstance(value, dict):
        return []
    raw = value.get(key)
    return raw if isinstance(raw, list) else []


def _contains_phrase(text: str, phrase: str) -> bool:
    normalized = _normalize_text(text)
    normalized_phrase = _normalize_text(phrase)
    if not normalized_phrase:
        return False

    if re.search(r"[a-z0-9]", normalized_phrase):
        return re.search(rf"\b{re.escape(normalized_phrase)}\b", normalized) is not None

    return _compact_text(normalized_phrase) in _compact_text(normalized)


def _contains_any(text: str, phrases: list[str]) -> str | None:
    for phrase in phrases:
        if isinstance(phrase, str) and _contains_phrase(text, phrase):
            return phrase
    return None


def _meaningful_length(text: str) -> int:
    return len(re.findall(r"[\w\u4e00-\u9fff]", text or ""))


def _cjk_terms(text: str) -> set[str]:
    terms: set[str] = set()
    for chunk in re.findall(r"[\u4e00-\u9fff]{2,}", text or ""):
        terms.add(chunk)
        for size in (2, 3, 4):
            if len(chunk) < size:
                continue
            terms.update(
                chunk[index : index + size] for index in range(len(chunk) - size + 1)
            )
    return terms


def _word_terms(text: str) -> set[str]:
    return {token.lower() for token in re.findall(r"[a-zA-Z]{3,}", text or "")}


def _tokens(text: str) -> set[str]:
    return _cjk_terms(text) | _word_terms(text)


def _factor_terms(factor: str) -> set[str]:
    terms = _tokens(factor)
    compact = _compact_text(factor)
    if len(compact) >= 2:
        terms.add(compact)
    return terms


def _factor_matches(draft_text: str, factors: list[str]) -> bool:
    compact_draft = _compact_text(draft_text)
    draft_terms = _tokens(draft_text)
    for factor in factors:
        if not isinstance(factor, str) or not factor.strip():
            continue
        compact_factor = _compact_text(factor)
        if compact_factor and compact_factor in compact_draft:
            return True
        if draft_terms & _factor_terms(factor):
            return True
    return False


def _is_generic_or_vague(text: str, flags: list[dict[str, Any]]) -> bool:
    if any(flag["type"] in {"TOO_VAGUE", "AI_TONE", "BANNED_PHRASE"} for flag in flags):
        return True
    return bool(
        _contains_any(
            text,
            [
                "可以试试",
                "不错",
                "希望能帮助",
                "了解更多",
                "more options",
                "learn more",
            ],
        )
    )


def _clamp_score(value: float) -> float:
    return max(0.0, min(1.0, round(value, 4)))


class DraftQualityChecker:
    def check(
        self,
        draft_text: str,
        comment_text: str,
        strategy: dict,
        platform_style: dict,
        brand_reply_profile: dict | None = None,
    ) -> dict:
        brand_reply_profile = (
            brand_reply_profile if isinstance(brand_reply_profile, dict) else {}
        )
        strategy = strategy if isinstance(strategy, dict) else {}
        platform_style = platform_style if isinstance(platform_style, dict) else {}

        text = str(draft_text or "")
        stripped = text.strip()
        flags: list[dict[str, Any]] = []

        def add_flag(
            flag_type: str,
            message: str,
            severity: str,
            evidence: str | None = None,
        ) -> None:
            flags.append(
                {
                    "type": flag_type,
                    "message": message,
                    "severity": severity,
                    "evidence": evidence,
                }
            )

        if not stripped:
            add_flag("EMPTY_REPLY", "Draft reply is empty.", "high", None)

        requires_specific = bool(strategy.get("require_specific_answer")) or bool(
            strategy.get("require_diagnostic")
        )
        if stripped and requires_specific:
            compact = _compact_text(stripped)
            if _meaningful_length(stripped) < 8 or any(
                compact == _compact_text(pattern) for pattern in TRIVIAL_REPLY_PATTERNS
            ):
                add_flag(
                    "TOO_VAGUE",
                    "Draft is too vague for a strategy that requires a specific answer.",
                    "medium",
                    stripped,
                )

        explicit_banned = (
            _list_from_dict(platform_style, "banned_phrases")
            + _list_from_dict(strategy, "forbidden_phrases")
            + _list_from_dict(brand_reply_profile, "forbidden_phrases")
        )
        banned_evidence = _contains_any(stripped, explicit_banned)
        if banned_evidence:
            add_flag(
                "BANNED_PHRASE",
                "Draft contains a banned customer-service or brand phrase.",
                "high",
                banned_evidence,
            )

        ai_evidence = _contains_any(
            stripped,
            [
                phrase
                for phrase in UNIVERSAL_AI_SMELL_PHRASES
                if phrase not in explicit_banned
            ],
        )
        if ai_evidence:
            add_flag(
                "AI_TONE",
                "Draft contains generic AI/customer-service phrasing.",
                "medium",
                ai_evidence,
            )

        if not bool(strategy.get("should_redirect")):
            cta_evidence = _contains_any(stripped, CTA_PHRASES)
            if cta_evidence:
                add_flag(
                    "CTA_VIOLATION",
                    "Draft includes CTA/store/link/private-message language while redirect is disabled.",
                    "high",
                    cta_evidence,
                )

        hard_sell_evidence = _contains_any(stripped, HARD_SELL_PHRASES)
        if hard_sell_evidence:
            add_flag(
                "HARD_SELL",
                "Draft contains aggressive sales language.",
                "high",
                hard_sell_evidence,
            )

        unsafe_evidence = _contains_any(stripped, UNSAFE_CLAIM_PHRASES)
        if unsafe_evidence:
            add_flag(
                "UNSAFE_CLAIM",
                "Draft contains unsafe or absolute claim language.",
                "high",
                unsafe_evidence,
            )

        if bool(strategy.get("require_diagnostic")) and stripped:
            diagnostic_factors = _list_from_dict(
                brand_reply_profile, "diagnostic_factors"
            )
            has_diagnostic = False
            if diagnostic_factors:
                has_diagnostic = _factor_matches(stripped, diagnostic_factors)
            else:
                has_diagnostic = bool(
                    _contains_any(stripped, DIAGNOSTIC_FALLBACK_TERMS)
                )

            if not has_diagnostic or _meaningful_length(stripped) < 12:
                add_flag(
                    "MISSING_DIAGNOSTIC",
                    "Draft does not include enough diagnostic content for this strategy.",
                    "medium",
                    None,
                )

        comment_tokens = _tokens(comment_text or "")
        draft_tokens = _tokens(stripped)
        if (
            _meaningful_length(comment_text or "") >= 10
            and len(comment_tokens) >= 4
            and draft_tokens
        ):
            overlap = len(comment_tokens & draft_tokens) / max(1, len(comment_tokens))
            if overlap < 0.05 and _is_generic_or_vague(stripped, flags):
                add_flag(
                    "LOW_RELEVANCE",
                    "Draft appears generic and has very low lexical overlap with the comment.",
                    "medium",
                    None,
                )

        max_length = platform_style.get("max_reply_length")
        try:
            max_length_int = int(max_length)
        except (TypeError, ValueError):
            max_length_int = 0
        if max_length_int > 0 and _meaningful_length(stripped) > max_length_int * 1.5:
            severity = (
                "medium"
                if _meaningful_length(stripped) > max_length_int * 2.2
                else "low"
            )
            add_flag(
                "TOO_LONG",
                "Draft is much longer than the platform style guidance.",
                severity,
                str(_meaningful_length(stripped)),
            )

        score = 1.0
        penalty_by_severity = {"high": 0.35, "medium": 0.20, "low": 0.10}
        for flag in flags:
            score -= penalty_by_severity.get(flag.get("severity"), 0.0)
        if any(flag["type"] == "EMPTY_REPLY" for flag in flags):
            score = min(score, 0.05)
        score = _clamp_score(score)

        blocking_flag_types = set(BLOCKING_FLAG_TYPES)
        if requires_specific:
            blocking_flag_types.add("TOO_VAGUE")
        has_blocking_flag = any(
            flag.get("type") in blocking_flag_types for flag in flags
        )
        passed = not has_blocking_flag and score >= 0.75
        return {
            "passed": passed,
            "score": score,
            "flags": flags,
        }
