from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.pipeline.draft.draft_qc import DraftQualityChecker  # noqa: E402
from ai_core.services.domain_profile_service import (
    build_brand_reply_profile,
)  # noqa: E402
from ai_core.services.reply_style_profiles import get_platform_style  # noqa: E402


def base_strategy(**overrides):
    strategy = {
        "should_redirect": False,
        "require_diagnostic": False,
        "require_specific_answer": False,
        "forbidden_phrases": [],
    }
    strategy.update(overrides)
    return strategy


def flag_types(result):
    return {flag["type"] for flag in result["flags"]}


def test_detects_ai_customer_service_phrase_and_cta_violation():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="你好！猫眼眼镜确实会给脸型带来独特的感觉。欢迎访问我们的店铺探索更多选择！",
        comment_text="帮我看下我算哪种脸型，为什么我带猫眼这么大，感觉好奇怪，是衣服原因吗？",
        strategy=base_strategy(require_diagnostic=True),
        platform_style=get_platform_style("xiaohongshu"),
    )

    flags = flag_types(result)
    assert result["passed"] is False
    assert flags & {"AI_TONE", "BANNED_PHRASE"}
    assert "CTA_VIOLATION" in flags


def test_detects_cta_violation_when_redirect_is_disabled():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="主页有链接哦～快去看看！",
        comment_text="适合我吗",
        strategy=base_strategy(should_redirect=False),
        platform_style=get_platform_style("xiaohongshu"),
    )

    assert result["passed"] is False
    assert "CTA_VIOLATION" in flag_types(result)


def test_missing_diagnostic_with_profile_is_flagged():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="可以试试看哦～",
        comment_text="帮我看下我算哪种脸型",
        strategy=base_strategy(require_diagnostic=True),
        platform_style=get_platform_style("xiaohongshu"),
        brand_reply_profile={"diagnostic_factors": ["镜框宽度", "上扬角度", "脸型比例"]},
    )

    assert result["passed"] is False
    assert flag_types(result) & {"MISSING_DIAGNOSTIC", "TOO_VAGUE"}


def test_missing_diagnostic_without_profile_is_flagged():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="可以试试看哦～",
        comment_text="敏感肌可以用吗？我之前用酸类会泛红",
        strategy=base_strategy(require_diagnostic=True),
        platform_style=get_platform_style("xiaohongshu"),
        brand_reply_profile=None,
    )

    assert result["passed"] is False
    assert flag_types(result) & {"MISSING_DIAGNOSTIC", "TOO_VAGUE"}


def test_missing_diagnostic_alone_is_blocking():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="这个看整体搭配会更自然一些，先不用急着换。",
        comment_text="帮我看下这个适合我吗",
        strategy=base_strategy(require_diagnostic=True),
        platform_style=get_platform_style("xiaohongshu"),
        brand_reply_profile={"diagnostic_factors": ["镜框宽度", "上扬角度", "脸型比例"]},
    )

    assert result["score"] >= 0.75
    assert flag_types(result) == {"MISSING_DIAGNOSTIC"}
    assert result["passed"] is False


def test_ai_tone_alone_is_blocking():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="Thank you for your interest. This should work for that use case.",
        comment_text="Would this work?",
        strategy=base_strategy(should_redirect=True),
        platform_style={"max_reply_length": 200, "banned_phrases": []},
    )

    assert result["score"] >= 0.75
    assert flag_types(result) == {"AI_TONE"}
    assert result["passed"] is False


def test_advisory_purchase_word_does_not_trigger_cta_violation():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="不建议购买太夸张的大框，先试小一圈会更自然。",
        comment_text="这个框会不会太大？",
        strategy=base_strategy(should_redirect=False),
        platform_style=get_platform_style("xiaohongshu"),
    )

    assert "CTA_VIOLATION" not in flag_types(result)


def test_clean_suitability_advice_passes_with_profile_factors():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="不是你不适合猫眼，主要是这副镜框宽度偏大、上扬角度也比较强，所以有点抢脸。换小一圈会自然很多～",
        comment_text="帮我看下我算哪种脸型，为什么我带猫眼这么大，感觉好奇怪，是衣服原因吗？",
        strategy=base_strategy(require_diagnostic=True),
        platform_style=get_platform_style("xiaohongshu"),
        brand_reply_profile={"diagnostic_factors": ["镜框宽度", "上扬角度", "脸型比例"]},
    )

    assert result["passed"] is True
    assert result["score"] >= 0.75


def test_qc_uses_auto_derived_profile_diagnostic_factors():
    checker = DraftQualityChecker()
    profile = build_brand_reply_profile(
        product_context={
            "name": "Ava Cat Eye",
            "category": "sunglasses",
            "description": "UV400 cat eye sunglasses for Asian face shape",
        }
    )
    strategy = base_strategy(require_diagnostic=True)
    platform_style = get_platform_style("xiaohongshu")

    passing_result = checker.check(
        draft_text="主要是这副镜框宽度偏大、上扬角度也比较强，所以有点抢脸。换小一圈会自然很多～",
        comment_text="帮我看下这个猫眼为什么显得怪",
        strategy=strategy,
        platform_style=platform_style,
        brand_reply_profile=profile,
    )
    failing_result = checker.check(
        draft_text="可以试试看哦～",
        comment_text="帮我看下这个猫眼为什么显得怪",
        strategy=strategy,
        platform_style=platform_style,
        brand_reply_profile=profile,
    )

    assert passing_result["passed"] is True
    assert failing_result["passed"] is False
    assert flag_types(failing_result) & {"MISSING_DIAGNOSTIC", "TOO_VAGUE"}


def test_detects_unsafe_claims():
    checker = DraftQualityChecker()

    result = checker.check(
        draft_text="敏感肌也可以放心用，适合所有肤质，一定有效。",
        comment_text="敏感肌可以用吗？",
        strategy=base_strategy(),
        platform_style=get_platform_style("xiaohongshu"),
    )

    assert result["passed"] is False
    assert flag_types(result) & {"UNSAFE_CLAIM", "HARD_SELL"}


def test_flags_replies_far_beyond_platform_length_guidance():
    checker = DraftQualityChecker()
    long_draft = "这条回复需要更短一点。" * 20 + "建议先看自己的需求和使用场景，再决定怎么调整。"

    result = checker.check(
        draft_text=long_draft,
        comment_text="这个适合我吗",
        strategy=base_strategy(),
        platform_style=get_platform_style("xiaohongshu"),
    )

    too_long_flags = [flag for flag in result["flags"] if flag["type"] == "TOO_LONG"]
    assert too_long_flags
    assert too_long_flags[0]["severity"] in {"low", "medium"}
