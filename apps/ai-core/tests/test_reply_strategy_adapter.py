from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.services.reply_strategy_adapter import adapt_reply_strategy  # noqa: E402


def fallback_strategy(comment_text):
    return adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text=comment_text,
    )


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
    assert strategy["product_grounding_mode"] == "diagnostic_then_product_support"


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
    assert strategy["product_grounding_mode"] == "product_first"


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
    assert strategy["product_grounding_mode"] == "product_first"


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


def test_product_grounding_mode_mappings():
    cases = [
        ("FIT_SUITABILITY", "suitability_advice", "diagnostic_then_product_support"),
        ("PRODUCT_INQUIRY", "product_question", "answer_from_product"),
        ("PURCHASE_INTENT", "purchase_request", "product_first"),
        ("LATENT_PURCHASE", "purchase_request", "product_first"),
        ("LINK_REQUEST", "purchase_request", "product_first"),
        (
            "COST_BENEFIT_HESITATION",
            "objection_or_concern",
            "concern_first_product_support",
        ),
        ("POST_PURCHASE_REGRET", "complaint_or_negative", "repair_first_no_sell"),
        ("NOISE", "irrelevant_or_low_value", "none"),
    ]

    for intent, expected_intent, expected_mode in cases:
        strategy = adapt_reply_strategy(
            intent=intent,
            buyer_stage="EVALUATING",
            confidence=0.9,
            risk_level="LOW",
            platform="xiaohongshu",
            comment_text="这个怎么样",
        )

        assert strategy["reply_intent"] == expected_intent
        assert strategy["product_grounding_mode"] == expected_mode


def test_generic_suitability_fallback_works_without_domain_terms():
    strategy = adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text="新手可以用吗",
    )

    assert strategy["reply_intent"] == "suitability_advice"
    assert strategy["product_grounding_mode"] == "diagnostic_then_product_support"


def test_pet_specific_word_alone_does_not_trigger_suitability():
    strategy = adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text="小猫好可爱",
    )

    assert strategy["reply_intent"] != "suitability_advice"
    assert strategy["reply_intent"] in {"compliment_or_interest", "general_interest"}


def test_face_domain_word_alone_does_not_trigger_suitability():
    strategy = adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text="脸型真的好看",
    )

    assert strategy["reply_intent"] != "suitability_advice"
    assert strategy["reply_intent"] in {"compliment_or_interest", "general_interest"}


def test_will_it_alone_does_not_force_suitability():
    strategy = adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text="会不会很贵",
    )

    assert strategy["reply_intent"] != "suitability_advice"
    assert strategy["reply_intent"] in {"objection_or_concern", "product_question"}


def test_explicit_will_it_suitability_still_maps_to_suitability():
    strategy = adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform="xiaohongshu",
        comment_text="会不会不适合圆脸",
    )

    assert strategy["reply_intent"] == "suitability_advice"
    assert strategy["product_grounding_mode"] == "diagnostic_then_product_support"


def test_product_inquiry_purchase_wording_upgrades_to_product_first():
    strategy = adapt_reply_strategy(
        intent="PRODUCT_INQUIRY",
        buyer_stage="READY",
        confidence=0.88,
        risk_level="LOW",
        platform="xiaohongshu",
        comment_text="这个哪里买啊",
    )

    assert strategy["reply_intent"] == "purchase_request"
    assert strategy["product_grounding_mode"] == "product_first"


def test_chinese_fallback_buckets():
    cases = [
        ("会不会很贵", "objection_or_concern"),
        ("会不会不适合圆脸", "suitability_advice"),
        ("Mac 支持吗", "product_question"),
        ("这个可以连接手机吗", "product_question"),
        ("这个可以用吗", "product_question"),
        ("新手可以用吗", "suitability_advice"),
        ("A和B哪个好", "comparison_request"),
        ("这个怎么安装", "usage_advice"),
    ]

    for comment_text, expected_intent in cases:
        strategy = fallback_strategy(comment_text)

        assert strategy["reply_intent"] == expected_intent


def test_chinese_safety_suitability_adds_risk_flag():
    for comment_text in ("敏感肌可以用吗", "小猫可以吃吗"):
        strategy = fallback_strategy(comment_text)

        assert strategy["reply_intent"] == "suitability_advice"
        assert strategy["product_grounding_mode"] == "diagnostic_then_product_support"
        assert "SAFETY_SUITABILITY" in strategy["risk_flags"]


def test_chinese_domain_words_alone_do_not_trigger_suitability():
    for comment_text in ("小猫好可爱", "脸型真的好看"):
        strategy = fallback_strategy(comment_text)

        assert strategy["reply_intent"] != "suitability_advice"
        assert strategy["reply_intent"] in {
            "compliment_or_interest",
            "general_interest",
        }


def test_english_fallback_buckets():
    cases = [
        ("where can I buy this", "purchase_request"),
        ("how much is this", "purchase_request"),
        ("link please", "purchase_request"),
        ("would this suit me", "suitability_advice"),
        ("does this work with Mac", "product_question"),
        ("is it too expensive", "objection_or_concern"),
    ]

    for comment_text, expected_intent in cases:
        strategy = fallback_strategy(comment_text)

        assert strategy["reply_intent"] == expected_intent


def test_standalone_link_does_not_force_purchase_request():
    cases = [
        ("how to link my account", {"usage_advice", "product_question"}),
        ("can I link this with Shopify", {"product_question", "usage_advice"}),
    ]

    for comment_text, acceptable_intents in cases:
        strategy = fallback_strategy(comment_text)

        assert strategy["reply_intent"] != "purchase_request"
        assert strategy["reply_intent"] in acceptable_intents


def test_english_safety_suitability_adds_risk_flag():
    strategy = fallback_strategy("safe for pregnant")

    assert strategy["reply_intent"] == "suitability_advice"
    assert "SAFETY_SUITABILITY" in strategy["risk_flags"]


def test_malay_indonesian_fallback_buckets():
    cases = [
        ("mana beli", "purchase_request"),
        ("harga berapa", "purchase_request"),
        ("ada link", "purchase_request"),
        ("sesuai untuk beginner tak", "suitability_advice"),
        ("compatible dengan Android tak", "product_question"),
        ("mahal tak", "objection_or_concern"),
        ("cocok untuk pemula gak", "suitability_advice"),
        ("bisa connect ke iPhone", "product_question"),
    ]

    for comment_text, expected_intent in cases:
        strategy = fallback_strategy(comment_text)

        assert strategy["reply_intent"] == expected_intent


def test_indonesian_safety_suitability_adds_risk_flag():
    strategy = fallback_strategy("kucing bisa makan")

    assert strategy["reply_intent"] == "suitability_advice"
    assert "SAFETY_SUITABILITY" in strategy["risk_flags"]
