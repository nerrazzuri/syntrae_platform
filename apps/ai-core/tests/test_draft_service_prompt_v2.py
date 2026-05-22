from pathlib import Path
from types import SimpleNamespace
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.services.draft_service import (  # noqa: E402
    PROMPT_VERSION,
    DraftGenerationService,
)


class FakeLLMClient:
    def __init__(self, response="测试回复"):
        self.response = response
        self.calls = []

    def chat_completion(self, messages, temperature=None, system_message=None):
        self.calls.append(
            {
                "messages": messages,
                "temperature": temperature,
                "system_message": system_message,
            }
        )
        return self.response


class FakeQuery:
    def __init__(self, lead):
        self.lead = lead

    def filter(self, *args):
        return self

    def first(self):
        return self.lead


class FakeDB:
    def __init__(self, lead):
        self.lead = lead

    def query(self, model):
        return FakeQuery(self.lead)


def make_lead(**overrides):
    base = {
        "id": "lead-1",
        "account_id": "account-1",
        "platform": "xiaohongshu",
        "intent": "FIT_SUITABILITY",
        "buyer_stage": "EVALUATING",
        "confidence": 0.91,
        "risk_level": "LOW",
        "recommended_action": "PRIORITY_DM",
        "preferences": {},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def make_owner_settings(**overrides):
    base = {
        "comment_text": "帮我看下我算哪种脸型，为什么我带猫眼这么大，感觉好奇怪，是衣服原因吗？这是试戴",
        "brand_name": "SUNGLASS",
        "brand_domain": "sunglass.com",
        "platform": "xiaohongshu",
        "intent": "FIT_SUITABILITY",
        "buyer_stage": "EVALUATING",
        "preferred_language": "zh-CN",
        "reply_redirect_target": "STORE",
        "reply_cta_style": "SOFT",
        "brand_reply_profile": {
            "reply_principles": ["先判断具体问题，再给建议"],
            "forbidden_phrases": ["不要像客服"],
            "diagnostic_factors": ["脸型", "框型大小", "上扬角度"],
        },
    }
    base.update(overrides)
    return base


def generate(owner_settings=None, lead=None, response="测试回复"):
    fake_llm = FakeLLMClient(response=response)
    service = DraftGenerationService(FakeDB(lead or make_lead()), fake_llm)
    result = service.generate_draft(
        lead_id="lead-1",
        account_id="account-1",
        owner_settings=owner_settings or make_owner_settings(),
    )
    return result, fake_llm


def first_user_prompt(fake_llm):
    return fake_llm.calls[0]["messages"][0]["content"]


def test_system_user_prompt_separation():
    result, fake_llm = generate()

    assert result["draft_text"] == "测试回复"
    call = fake_llm.calls[0]
    assert call["system_message"] is not None
    assert "SUNGLASS" in call["system_message"]
    assert "Authenticity > salesmanship" in call["system_message"]
    assert "STRICT RULES" not in call["system_message"]

    user_prompt = call["messages"][0]["content"]
    assert "帮我看下我算哪种脸型" in user_prompt
    assert "Reply strategy" in user_prompt
    assert "advisor_diagnostic" in user_prompt
    assert "- 回复重点：" in user_prompt
    assert "脸型" in user_prompt
    assert "STRICT RULES" not in user_prompt


def test_user_prompt_includes_product_grounding_mode_for_suitability():
    _result, fake_llm = generate()

    user_prompt = first_user_prompt(fake_llm)
    assert "product_grounding_mode" in user_prompt
    assert "diagnostic_then_product_support" in user_prompt
    assert "先诊断用户情况" in user_prompt


def test_purchase_request_prompt_allows_product_first_and_soft_cta():
    owner_settings = make_owner_settings(
        comment_text="这个哪里买啊",
        intent="PURCHASE_INTENT",
        buyer_stage="READY",
    )
    lead = make_lead(intent="PURCHASE_INTENT", buyer_stage="READY")

    _result, fake_llm = generate(owner_settings=owner_settings, lead=lead)

    user_prompt = first_user_prompt(fake_llm)
    assert "product_first" in user_prompt
    assert "Product information can be the main answer" in user_prompt
    assert "soft CTA is acceptable" in user_prompt


def test_product_question_prompt_answers_from_product_context_first():
    owner_settings = make_owner_settings(
        comment_text="这个镜框材质是什么",
        intent="PRODUCT_INQUIRY",
        buyer_stage="EVALUATING",
        product_context={
            "name": "AirFrame",
            "category": "eyewear",
            "description": "Lightweight TR90 frame",
            "key_benefits": ["lightweight"],
        },
    )
    lead = make_lead(intent="PRODUCT_INQUIRY", buyer_stage="EVALUATING")

    _result, fake_llm = generate(owner_settings=owner_settings, lead=lead)

    user_prompt = first_user_prompt(fake_llm)
    assert "answer_from_product" in user_prompt
    assert "先回答产品/功能/规格问题" in user_prompt
    assert "AirFrame" in user_prompt


def test_draft_service_builds_normalized_profile_without_owner_profile():
    owner_settings = make_owner_settings()
    owner_settings.pop("brand_reply_profile")

    _result, fake_llm = generate(owner_settings=owner_settings)

    user_prompt = first_user_prompt(fake_llm)
    assert '"version": 1' in user_prompt
    assert '"source": "auto_derived"' in user_prompt
    assert (
        "Answer the user's actual question before mentioning products." in user_prompt
    )


def test_sunglasses_product_context_adds_inferred_profile_guidance():
    owner_settings = make_owner_settings(
        brand_domain="sunglasses",
        product_context={
            "name": "Ava Cat Eye",
            "category": "sunglasses",
            "description": "UV400 cat eye sunglasses for Asian face shape",
        },
    )
    owner_settings.pop("brand_reply_profile")

    _result, fake_llm = generate(owner_settings=owner_settings)

    user_prompt = first_user_prompt(fake_llm)
    assert "镜框宽度" in user_prompt or "上扬角度" in user_prompt
    assert "先判断款式比例" in user_prompt


def test_existing_brand_reply_profile_values_are_preserved_in_prompt():
    owner_settings = make_owner_settings(
        brand_reply_profile={
            "domain_label": "custom_domain",
            "diagnostic_factors": ["Custom Factor"],
            "forbidden_phrases": ["Never say X"],
            "reply_principles": ["Custom principle"],
        }
    )

    _result, fake_llm = generate(owner_settings=owner_settings)

    user_prompt = first_user_prompt(fake_llm)
    system_prompt = fake_llm.calls[0]["system_message"]
    assert '"domain_label": "custom_domain"' in user_prompt
    assert "Custom Factor" in user_prompt
    assert "Never say X" in user_prompt
    assert "Custom principle" in user_prompt
    assert "Custom principle" in system_prompt


def test_strategy_driven_cta_control_for_suitability():
    result, _fake_llm = generate()

    assert result["cta_target"] == "NONE"
    assert result["cta_label"] is None
    assert result["reply_strategy"] == "suitability_advice"
    assert result["strategy_meta"]["should_redirect"] is False


def test_purchase_request_allows_cta():
    owner_settings = make_owner_settings(
        comment_text="有链接吗",
        intent="PURCHASE_INTENT",
        buyer_stage="READY",
    )
    lead = make_lead(intent="PURCHASE_INTENT", buyer_stage="READY")

    result, _fake_llm = generate(owner_settings=owner_settings, lead=lead)

    assert result["cta_target"] != "NONE"
    assert result["strategy_meta"]["should_redirect"] is True


def test_backward_compatible_return_fields():
    result, _fake_llm = generate()

    for key in {
        "draft_text",
        "tone",
        "language",
        "source_language",
        "prompt_version",
        "cached",
        "cta_target",
        "cta_label",
        "reply_strategy",
        "risk_flags",
        "human_review_required",
    }:
        assert key in result


def test_prompt_version():
    result, _fake_llm = generate()

    assert result["prompt_version"] == PROMPT_VERSION
    assert result["prompt_version"] == "v2_strategy_platform_profile"


def test_clean_reply_text_strips_only_outer_ascii_double_quotes():
    service = DraftGenerationService(FakeDB(make_lead()), FakeLLMClient())

    assert service._clean_reply_text('"测试回复"') == "测试回复"
    assert service._clean_reply_text("「不是你不适合猫眼」") == "「不是你不适合猫眼」"
    assert service._clean_reply_text("“不是你不适合猫眼”") == "“不是你不适合猫眼”"
