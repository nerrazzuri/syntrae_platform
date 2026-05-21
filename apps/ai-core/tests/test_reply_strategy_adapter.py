from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.services.reply_strategy_adapter import adapt_reply_strategy  # noqa: E402


def test_fit_suitability_maps_to_advisor_diagnostic():
    strategy = adapt_reply_strategy(
        intent="FIT_SUITABILITY",
        buyer_stage="EVALUATING",
        confidence=0.9,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="帮我看下我算哪种脸型，为什么我带猫眼这么大，感觉好奇怪，是衣服原因吗？这是试戴",
    )

    assert strategy["reply_intent"] == "suitability_advice"
    assert strategy["reply_mode"] == "advisor_diagnostic"
    assert strategy["should_redirect"] is False
    assert strategy["cta_strength"] == "none"
    assert strategy["require_diagnostic"] is True
    assert strategy["require_specific_answer"] is True


def test_purchase_request_fallback():
    strategy = adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text="有链接吗",
    )

    assert strategy["reply_intent"] == "purchase_request"
    assert strategy["should_redirect"] is True
    assert strategy["cta_strength"] in {"soft", "direct"}


def test_product_inquiry_with_purchase_wording_allows_redirect():
    strategy = adapt_reply_strategy(
        intent="PRODUCT_INQUIRY",
        buyer_stage="READY",
        confidence=0.88,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="这个哪里买啊",
    )

    assert strategy["reply_intent"] == "purchase_request"
    assert strategy["should_redirect"] is True
    assert strategy["cta_strength"] in {"soft", "direct"}


def test_skincare_suitability_stays_diagnostic_without_redirect():
    strategy = adapt_reply_strategy(
        intent="FIT_SUITABILITY",
        buyer_stage="EVALUATING",
        confidence=0.9,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="敏感肌可以用吗？我之前用酸类会泛红",
    )

    assert strategy["reply_intent"] == "suitability_advice"
    assert strategy["should_redirect"] is False
    assert strategy["require_diagnostic"] is True


def test_pet_suitability_stays_diagnostic_without_redirect():
    strategy = adapt_reply_strategy(
        intent="FIT_SUITABILITY",
        buyer_stage="EVALUATING",
        confidence=0.9,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="三个月小猫可以吃吗？肠胃比较弱",
    )

    assert strategy["reply_intent"] == "suitability_advice"
    assert strategy["should_redirect"] is False
    assert strategy["require_diagnostic"] is True


def test_complaint_negative_adds_risk_flag():
    strategy = adapt_reply_strategy(
        intent="POST_PURCHASE_REGRET",
        buyer_stage="EVALUATING",
        confidence=0.8,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="买了有点后悔，感觉不好用",
    )

    assert strategy["reply_intent"] == "complaint_or_negative"
    assert strategy["should_redirect"] is False
    assert "NEGATIVE_OR_COMPLAINT" in strategy["risk_flags"]


def test_forbidden_phrases_and_diagnostic_focus_merge():
    strategy = adapt_reply_strategy(
        intent="FIT_SUITABILITY",
        buyer_stage="EVALUATING",
        confidence=0.9,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="适合我吗",
        owner_settings={"forbidden_phrases": ["不要说A"]},
        brand_reply_profile={
            "forbidden_phrases": ["不要说B"],
            "diagnostic_factors": ["因素1", "因素2"],
        },
    )

    assert "欢迎访问" in strategy["forbidden_phrases"]
    assert "不要说A" in strategy["forbidden_phrases"]
    assert "不要说B" in strategy["forbidden_phrases"]
    assert "因素1" in strategy["suggested_focus"] or "因素2" in strategy["suggested_focus"]
