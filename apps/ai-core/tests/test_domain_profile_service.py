from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.services.domain_profile_service import (
    build_brand_reply_profile,
)  # noqa: E402


REQUIRED_KEYS = {
    "version",
    "source",
    "domain_label",
    "domain_confidence",
    "target_audience",
    "customer_concerns",
    "diagnostic_factors",
    "reply_principles",
    "purchase_triggers",
    "clarifying_questions",
    "forbidden_phrases",
    "forbidden_claims",
    "safety_notes",
}

LIST_FIELDS = REQUIRED_KEYS - {
    "version",
    "source",
    "domain_label",
    "domain_confidence",
}


def test_empty_profile_returns_complete_shape():
    profile = build_brand_reply_profile()

    assert set(profile) == REQUIRED_KEYS
    assert profile["version"] == 1
    assert profile["source"] == "auto_derived"
    assert profile["domain_label"] == "generic"
    for field in LIST_FIELDS:
        assert isinstance(profile[field], list)


def test_sunglasses_profile_inference():
    profile = build_brand_reply_profile(
        brand_domain="sunglasses",
        product_context={
            "name": "Ava Cat Eye",
            "category": "sunglasses",
            "description": "UV400 cat eye sunglasses for Asian face shape",
        },
    )

    assert profile["domain_label"] in {"sunglasses", "eyewear"}
    assert set(profile["diagnostic_factors"]) & {"镜框宽度", "上扬角度", "脸型比例"}
    assert set(profile["customer_concerns"]) & {"显脸大", "低鼻梁", "不适合脸型"}
    assert set(profile["forbidden_claims"]) & {"保证显脸小", "100%适合所有脸型"}


def test_skincare_profile_inference():
    profile = build_brand_reply_profile(
        brand_domain="skincare",
        product_context={"description": "gentle serum for sensitive skin"},
    )

    assert profile["domain_label"] == "skincare"
    assert set(profile["diagnostic_factors"]) & {"肤质", "敏感程度"}
    assert set(profile["forbidden_claims"]) & {"适合所有肤质", "绝对安全"}


def test_pet_profile_inference():
    profile = build_brand_reply_profile(
        product_context={
            "category": "pet supplies",
            "description": "cat food for kitten with sensitive stomach",
        },
    )

    assert profile["domain_label"] == "pet_supplies"
    assert set(profile["diagnostic_factors"]) & {"宠物年龄", "肠胃状态"}
    assert profile["safety_notes"] or any(
        "少量尝试" in principle for principle in profile["reply_principles"]
    )


def test_electronics_profile_inference():
    profile = build_brand_reply_profile(
        product_context={
            "category": "charger",
            "description": "USB-C 100W laptop charger",
        },
    )

    assert profile["domain_label"] == "electronics"
    assert set(profile["diagnostic_factors"]) & {"功率/电压", "设备型号"}
    assert set(profile["customer_concerns"]) & {"兼容性", "发热"}


def test_saas_profile_inference():
    profile = build_brand_reply_profile(
        product_context={
            "category": "software",
            "description": "automation dashboard for small teams",
        },
    )

    assert profile["domain_label"] == "saas"
    assert set(profile["diagnostic_factors"]) & {"团队规模", "使用场景"}
    assert set(profile["forbidden_claims"]) & {"100%自动化", "保证增长"}


def test_existing_profile_wins_and_merges():
    profile = build_brand_reply_profile(
        brand_domain="sunglasses",
        existing_profile={
            "domain_label": "custom_domain",
            "diagnostic_factors": ["Custom Factor"],
            "forbidden_phrases": ["Never say X"],
            "reply_principles": ["Custom principle"],
        },
    )

    assert profile["source"] == "merged"
    assert profile["domain_label"] == "custom_domain"
    assert "Custom Factor" in profile["diagnostic_factors"]
    assert "Never say X" in profile["forbidden_phrases"]
    assert "Custom principle" in profile["reply_principles"]
    assert (
        "Answer the user's actual question before mentioning products."
        in profile["reply_principles"]
    )


def test_product_context_extraction():
    profile = build_brand_reply_profile(
        product_context={
            "target_buyer": "busy working moms",
            "common_objections": ["too expensive", "hard to use"],
            "key_benefits": ["fast setup"],
        },
    )

    assert "busy working moms" in profile["target_audience"]
    assert "too expensive" in profile["customer_concerns"]
    assert "hard to use" in profile["customer_concerns"]


def test_owner_settings_brand_domain_and_tone_are_read():
    profile = build_brand_reply_profile(
        owner_settings={"brand_domain": "skincare", "tone": "warm"}
    )

    assert profile["domain_label"] == "skincare"
    assert "Match the configured tone: warm." in profile["reply_principles"]


def test_deduplication_case_insensitive():
    profile = build_brand_reply_profile(
        existing_profile={
            "forbidden_phrases": [
                "欢迎访问",
                "WELCOME VISIT",
                "welcome visit",
            ]
        },
        owner_settings={"forbidden_phrases": ["欢迎访问"]},
    )

    lowered = [phrase.lower() for phrase in profile["forbidden_phrases"]]
    assert lowered.count("欢迎访问") == 1
    assert lowered.count("welcome visit") == 1
