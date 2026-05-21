from pathlib import Path
from types import SimpleNamespace
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.services.draft_service import DraftGenerationService  # noqa: E402


BAD_DRAFT = "你好！猫眼眼镜确实会给脸型带来独特的感觉。欢迎访问我们的店铺探索更多选择！"
GOOD_DRAFT = "不是你不适合猫眼，主要是这副镜框宽度偏大、上扬角度也比较强，所以有点抢脸。换小一圈会自然很多～"


class SequentialFakeLLMClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def chat_completion(self, messages, temperature=None, system_message=None):
        self.calls.append(
            {
                "messages": messages,
                "temperature": temperature,
                "system_message": system_message,
            }
        )
        if self.responses:
            return self.responses.pop(0)
        return "fallback reply"


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
            "diagnostic_factors": ["镜框宽度", "上扬角度", "脸型比例"],
        },
    }
    base.update(overrides)
    return base


def generate_with_responses(responses, owner_settings=None, lead=None):
    fake_llm = SequentialFakeLLMClient(responses)
    service = DraftGenerationService(FakeDB(lead or make_lead()), fake_llm)
    result = service.generate_draft(
        lead_id="lead-1",
        account_id="account-1",
        owner_settings=owner_settings or make_owner_settings(),
    )
    return result, fake_llm


def flag_types(result):
    return {flag["type"] for flag in result["qc_status"]["flags"]}


def test_qc_pass_does_not_rewrite():
    result, fake_llm = generate_with_responses([GOOD_DRAFT])

    assert len(fake_llm.calls) == 1
    assert result["draft_text"] == GOOD_DRAFT
    assert result["rewrite_attempted"] is False
    assert result["qc_status"]["passed"] is True


def test_qc_fail_triggers_one_rewrite():
    result, fake_llm = generate_with_responses([BAD_DRAFT, GOOD_DRAFT])

    assert len(fake_llm.calls) == 2
    assert result["rewrite_attempted"] is True
    assert result["draft_text"] == GOOD_DRAFT
    assert result["qc_status"]["passed"] is True


def test_rewrite_still_fails_returns_flagged_best_available():
    result, fake_llm = generate_with_responses([BAD_DRAFT, "欢迎访问我们的店铺探索更多选择！"])

    assert len(fake_llm.calls) == 2
    assert result["rewrite_attempted"] is True
    assert "qc_status" in result
    assert flag_types(result) & {"BANNED_PHRASE", "AI_TONE", "CTA_VIOLATION"}
    assert set(result["risk_flags"]) & {"BANNED_PHRASE", "AI_TONE", "CTA_VIOLATION"}
    assert result["human_review_required"] is True


def test_rewrite_prompt_includes_no_cta_instruction_for_non_redirect_strategy():
    _result, fake_llm = generate_with_responses([BAD_DRAFT, GOOD_DRAFT])

    rewrite_prompt = fake_llm.calls[1]["messages"][0]["content"]
    assert "If should_redirect=false" in rewrite_prompt
    assert "do not include CTA/store/link/private-message language" in rewrite_prompt
