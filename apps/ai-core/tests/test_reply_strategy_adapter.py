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


_SUNGLASSES_PROFILE = {
    'diagnostic_factors': ['镜框宽度', '镜片大小', '上扬角度', '鼻梁贴合度', '脸型比例', '穿搭风格'],
    'customer_concerns': ['显脸大', '低鼻梁', '压鼻梁', '不适合脸型', '拍照不自然'],
}
_EYEWEAR_PRODUCT_CTX = {'name': 'SUNGLASS', 'category': '墨镜', 'description': 'UV400墨镜'}


def _eyewear_fallback(comment_text):
    return adapt_reply_strategy(
        intent=None,
        buyer_stage=None,
        confidence=None,
        risk_level=None,
        platform='xiaohongshu',
        comment_text=comment_text,
        product_context=_EYEWEAR_PRODUCT_CTX,
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )


def test_product_value_question_is_not_suitability():
    strategy = _eyewear_fallback('小米的99的墨镜可以吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_uv_feature_question_is_not_suitability():
    strategy = _eyewear_fallback('防UV不是偏光镜，这种还要买吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_sunscreen_feature_question_is_not_suitability():
    strategy = _eyewear_fallback('这个墨镜有防晒效果吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_face_shape_question_with_suitability_intent_stays_suitability():
    # LLM correctly scores FIT_SUITABILITY; adapter must honour it
    strategy = adapt_reply_strategy(
        intent='FIT_SUITABILITY',
        buyer_stage='EVALUATING',
        confidence=0.85,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text='圆脸适合猫眼吗',
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )
    assert strategy['reply_intent'] == 'suitability_advice'


def test_face_concern_with_suitability_intent_remains_suitability():
    strategy = adapt_reply_strategy(
        intent='FIT_SUITABILITY',
        buyer_stage='EVALUATING',
        confidence=0.85,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text='脸大戴这个会不会更显大',
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )
    assert strategy['reply_intent'] == 'suitability_advice'


def test_frame_size_concern_with_suitability_intent_remains_suitability():
    strategy = adapt_reply_strategy(
        intent='FIT_SUITABILITY',
        buyer_stage='EVALUATING',
        confidence=0.85,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text='小脸是不是撑不起大框',
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )
    assert strategy['reply_intent'] == 'suitability_advice'


def test_product_question_intent_excludes_diagnostic_factors_from_focus():
    strategy = adapt_reply_strategy(
        intent='PRODUCT_INQUIRY',
        buyer_stage='EVALUATING',
        confidence=0.8,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text='小米的99的墨镜可以吗',
        product_context=_EYEWEAR_PRODUCT_CTX,
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )
    assert strategy['reply_intent'] == 'product_question'
    focus = strategy.get('suggested_focus', '')
    assert '镜框宽度' not in focus
    assert '镜片大小' not in focus
    # diagnostic_factors should also be in forbidden_phrases for non-suitability
    assert '镜框宽度' in strategy['forbidden_phrases']
    assert '镜片大小' in strategy['forbidden_phrases']


def test_suitability_advice_does_not_ban_diagnostic_factors():
    strategy = adapt_reply_strategy(
        intent='FIT_SUITABILITY',
        buyer_stage='EVALUATING',
        confidence=0.85,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text='圆脸适合猫眼吗',
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )
    assert strategy['reply_intent'] == 'suitability_advice'
    # diagnostic_factors must NOT be banned for genuine suitability
    assert '镜框宽度' not in strategy['forbidden_phrases']
    assert '镜片大小' not in strategy['forbidden_phrases']


# --- FIT_SUITABILITY content-based override tests ---
# All helpers below pass stored intent=FIT_SUITABILITY so the override logic runs.

def _eyewear_stored_suitability(comment_text):
    return adapt_reply_strategy(
        intent='FIT_SUITABILITY',
        buyer_stage='EVALUATING',
        confidence=0.85,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text=comment_text,
        product_context=_EYEWEAR_PRODUCT_CTX,
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )


# Non-suitability overrides (stored FIT_SUITABILITY on non-suitability comments)

def test_override_value_comparison_is_product_question():
    strategy = _eyewear_stored_suitability('小米的99的墨镜可以吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_override_uv_feature_question_is_product_question():
    strategy = _eyewear_stored_suitability('防UV不是偏光镜，这种还要买吗')
    assert strategy['reply_intent'] == 'product_question'


def test_override_sunscreen_feature_question_is_product_question():
    strategy = _eyewear_stored_suitability('这个墨镜有防晒效果吗')
    assert strategy['reply_intent'] == 'product_question'


def test_override_brand_inquiry_is_product_question():
    strategy = _eyewear_stored_suitability('这是什么品牌呀')
    assert strategy['reply_intent'] == 'product_question'


def test_override_brand_name_vs_store_name_is_product_question():
    strategy = _eyewear_stored_suitability('SUNGLASS 是店名还是品牌名')
    assert strategy['reply_intent'] == 'product_question'


def test_override_color_availability_is_product_question():
    strategy = _eyewear_stored_suitability('有黑色吗')
    assert strategy['reply_intent'] == 'product_question'


def test_override_clip_on_feature_is_product_question():
    strategy = _eyewear_stored_suitability('有近视夹片吗')
    assert strategy['reply_intent'] == 'product_question'


def test_override_prescription_capability_is_product_question():
    strategy = _eyewear_stored_suitability('可以配度数吗')
    assert strategy['reply_intent'] == 'product_question'


def test_override_shipping_question_is_not_suitability():
    strategy = _eyewear_stored_suitability('马来西亚可以寄吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_override_purchase_link_request_is_purchase_request():
    strategy = _eyewear_stored_suitability('主页没看到链接，是哪一款')
    assert strategy['reply_intent'] == 'purchase_request'


# True suitability remains (face/fit anchors block the override)

def test_override_does_not_fire_on_round_face_question():
    strategy = _eyewear_stored_suitability('圆脸适合猫眼吗')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_override_does_not_fire_on_face_size_concern():
    strategy = _eyewear_stored_suitability('脸大戴这个会不会更显大')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_override_does_not_fire_on_small_face_fit():
    strategy = _eyewear_stored_suitability('小脸是不是撑不起大框')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_override_does_not_fire_on_cheekbone_fit():
    strategy = _eyewear_stored_suitability('颧骨高戴这种会不会显脸宽')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_override_does_not_fire_on_wear_feel_complaint():
    strategy = _eyewear_stored_suitability('为什么我戴猫眼感觉怪怪的')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_override_does_not_fire_on_aged_look_complaint():
    strategy = _eyewear_stored_suitability('我戴这个感觉很老气，是款式问题吗')
    assert strategy['reply_intent'] == 'suitability_advice'


# --- Phase 2: extended override for null/general_interest intents ---

def _eyewear_null_evaluating(comment_text):
    return adapt_reply_strategy(
        intent=None,
        buyer_stage='EVALUATING',
        confidence=None,
        risk_level=None,
        platform='xiaohongshu',
        comment_text=comment_text,
        product_context=_EYEWEAR_PRODUCT_CTX,
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )


def test_extended_override_value_comparison_with_null_intent():
    strategy = _eyewear_null_evaluating('小米的99的墨镜可以吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_extended_override_uv_feature_with_null_intent():
    strategy = _eyewear_null_evaluating('UV400不是偏光还要买吗')
    assert strategy['reply_intent'] == 'product_question'


def test_extended_override_color_with_null_intent():
    strategy = _eyewear_null_evaluating('有黑色吗')
    assert strategy['reply_intent'] == 'product_question'


def test_extended_override_shipping_with_null_intent():
    strategy = _eyewear_null_evaluating('马来西亚可以寄吗')
    assert strategy['reply_intent'] != 'suitability_advice'


def test_link_request_intent_maps_to_purchase_request():
    strategy = adapt_reply_strategy(
        intent='LINK_REQUEST',
        buyer_stage='EVALUATING',
        confidence=0.9,
        risk_level='LOW',
        platform='xiaohongshu',
        comment_text='主页没看到链接，是哪一款',
        product_context=_EYEWEAR_PRODUCT_CTX,
        brand_reply_profile=_SUNGLASSES_PROFILE,
    )
    assert strategy['reply_intent'] == 'purchase_request'


def test_extended_override_upgrades_face_question_to_suitability_with_null_intent():
    strategy = _eyewear_null_evaluating('圆脸适合猫眼吗')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_extended_override_face_concern_upgrades_to_suitability_with_null_intent():
    strategy = _eyewear_null_evaluating('脸大戴这个会不会更显大')
    assert strategy['reply_intent'] == 'suitability_advice'


# ---------------------------------------------------------------------------
# P10.2 — cross-industry routing tests
# ---------------------------------------------------------------------------

# --- skincare product_question ---

def test_skincare_volume_question_routes_to_product_question():
    assert fallback_strategy('这个精华液有多少ml？')['reply_intent'] == 'product_question'


def test_skincare_spf_question_routes_to_product_question():
    assert fallback_strategy('这款防晒的SPF是多少？')['reply_intent'] == 'product_question'


def test_skincare_ingredient_alcohol_question_routes_to_product_question():
    assert fallback_strategy('这个成分里有没有酒精？')['reply_intent'] == 'product_question'


# --- skincare suitability_advice ---

def test_skincare_sensitive_skin_suitability():
    assert fallback_strategy('敏感肌可以用吗？')['reply_intent'] == 'suitability_advice'


def test_skincare_pregnancy_suitability():
    assert fallback_strategy('孕妇可以用吗？')['reply_intent'] == 'suitability_advice'


def test_skincare_dry_skin_suitability():
    assert fallback_strategy('干皮用了会不会拔干？')['reply_intent'] == 'suitability_advice'


# --- makeup product_question ---

def test_makeup_shade_number_question_routes_to_product_question():
    assert fallback_strategy('这个口红的色号是几号？')['reply_intent'] == 'product_question'


def test_makeup_finish_type_question_routes_to_product_question():
    assert fallback_strategy('这款腮红是哑光还是带珠光的？')['reply_intent'] == 'product_question'


def test_makeup_color_count_question_routes_to_product_question():
    assert fallback_strategy('这个眼影盘有几个颜色？')['reply_intent'] == 'product_question'


# --- makeup suitability_advice ---

def test_makeup_yellow_skin_tone_suitability():
    assert fallback_strategy('黄皮适合这个色号吗？')['reply_intent'] == 'suitability_advice'


def test_makeup_beginner_ease_suitability():
    assert fallback_strategy('新手好上手吗？')['reply_intent'] == 'suitability_advice'


def test_makeup_bare_face_suitability():
    assert fallback_strategy('素颜涂这个口红会不会突兀？')['reply_intent'] == 'suitability_advice'


# --- SaaS product_question ---

def test_saas_integration_question_routes_to_product_question():
    assert fallback_strategy('Does it integrate with Slack?')['reply_intent'] == 'product_question'


def test_saas_export_question_routes_to_product_question():
    assert fallback_strategy('Can I export my data?')['reply_intent'] == 'product_question'


def test_saas_encryption_question_routes_to_product_question():
    assert fallback_strategy('Is customer data encrypted?')['reply_intent'] == 'product_question'


def test_saas_gdpr_question_routes_to_product_question():
    assert fallback_strategy('Is it GDPR compliant?')['reply_intent'] == 'product_question'


# --- SaaS suitability_advice ---

def test_saas_small_agency_suitability():
    assert fallback_strategy('Is it suitable for a small agency?')['reply_intent'] == 'suitability_advice'


def test_saas_non_technical_person_suitability():
    assert fallback_strategy('Can a non-technical person set this up?')['reply_intent'] == 'suitability_advice'


def test_saas_freelancer_suitability():
    assert fallback_strategy('Would this work for a freelancer?')['reply_intent'] == 'suitability_advice'


# --- purchase_request ---

def test_saas_book_demo_routes_to_purchase():
    assert fallback_strategy('Can I book a demo?')['reply_intent'] == 'purchase_request'


def test_saas_free_trial_routes_to_purchase():
    assert fallback_strategy('Is there a free trial?')['reply_intent'] == 'purchase_request'


def test_chinese_price_question_routes_to_purchase():
    assert fallback_strategy('多少钱？')['reply_intent'] == 'purchase_request'


def test_chinese_link_request_routes_to_purchase():
    assert fallback_strategy('有链接吗？')['reply_intent'] == 'purchase_request'


# --- comparison_request ---

def test_saas_different_from_comparison():
    assert fallback_strategy('How is this different from Notion?')['reply_intent'] == 'comparison_request'


def test_skincare_brand_comparison_more_gentle():
    assert fallback_strategy('和理肤泉比哪个更温和？')['reply_intent'] == 'comparison_request'


def test_makeup_brand_comparison_better():
    assert fallback_strategy('和完美日记比哪个好？')['reply_intent'] == 'comparison_request'


# --- objection_or_concern ---

def test_chinese_expensive_quality_concern():
    assert fallback_strategy('这个这么贵，效果真的有那么好吗？')['reply_intent'] == 'objection_or_concern'


def test_saas_cancellation_concern():
    assert fallback_strategy('What happens to our data if we cancel?')['reply_intent'] == 'objection_or_concern'


def test_saas_migration_nightmare_concern():
    assert fallback_strategy(
        'We tried a similar tool before and migrating our data was a nightmare.'
    )['reply_intent'] == 'objection_or_concern'


def test_chinese_counterfeit_concern():
    assert fallback_strategy('这个包装看起来很像仿品，怎么辨别？')['reply_intent'] == 'objection_or_concern'


# --- sunglasses regression ---

def test_sunglasses_color_question_is_product_question():
    strategy = _eyewear_fallback('有黑色吗？')
    assert strategy['reply_intent'] == 'product_question'


def test_sunglasses_face_shape_suitability_fallback():
    strategy = _eyewear_null_evaluating('圆脸适合猫眼吗？')
    assert strategy['reply_intent'] == 'suitability_advice'


def test_sunglasses_purchase_link_fallback():
    strategy = _eyewear_fallback('主页没看到链接，是哪一款？')
    assert strategy['reply_intent'] == 'purchase_request'
