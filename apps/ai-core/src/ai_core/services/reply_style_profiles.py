from __future__ import annotations


CUSTOMER_SERVICE_BANNED_PHRASES = [
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
    "请DM我们",
]

# XHS-specific customer-service phrases that break the human-comment voice.
# Applied on top of CUSTOMER_SERVICE_BANNED_PHRASES for xiaohongshu platform.
XHS_CS_BANNED_PHRASES = [
    "随时问我",
    "随时告诉我",
    "欢迎了解",
    "欢迎咨询",
    "有兴趣的话",
    "如果还有其他问题",
    "想了解更多",
    "可以咨询客服",
    "期待你的反馈",
    "你更看重哪方面",
    "你有什么特别的使用场景",
    "你平时用什么",
    "希望能帮到你",
    "亲亲",
    "宝子可以",
    "赶快入手",
    "不容错过",
]

_XHS_STYLE_INSTRUCTION = """\
XHS 评论区人类风格要求：
- 以真实评论区回复的方式写，不是客服对话。
- 默认 1–2 句话。除非用户问了多个问题，不要超过 3 句。
- 先直接回答问题，不要铺垫或重复用户的问题。
- 除非用户明确要求推荐或确有必要，不要以问句结尾。
- 不要在非购买类回复中加 CTA、进店引导或链接。
- 默认不用 Emoji，除非极其自然；不要用 Emoji 结尾。
- 避免以「哦/呀/呢」重复作结尾。
- 事实性问题：回答后停止，不加延伸解释。
- 适配类问题：给一个具体建议，不要展开成完整咨询。
- 顾虑类问题：简短承认，给一个实际理由，不要反问。\
"""


def _normalize_platform(platform: str | None) -> str:
    normalized = str(platform or "").strip().lower()
    aliases = {
        "xiaohongshu": "xiaohongshu",
        "xhs": "xiaohongshu",
        "rednote": "xiaohongshu",
        "小红书": "xiaohongshu",
        "tiktok": "tiktok",
        "douyin": "tiktok",
        "抖音": "tiktok",
        "instagram": "instagram",
        "facebook": "facebook",
        "generic": "generic",
    }
    return aliases.get(normalized, "generic")


def get_platform_style(platform: str | None, language: str | None = None) -> dict:
    platform_key = _normalize_platform(platform)

    if platform_key == "xiaohongshu":
        return {
            "platform_key": "xiaohongshu",
            "style_name": "xiaohongshu_advisor",
            "language_default": "zh-CN",
            "tone": "niche blogger / advisor, warm but not sycophantic",
            "max_reply_length": 80,
            "emoji_guidance": "0-1 only when completely natural; default to no emoji",
            "address_style": "casual; 宝子/姐妹 acceptable when natural; never 亲爱的用户/亲亲/您",
            "cultural_notes": (
                "Authenticity > salesmanship. Share-culture, not push-culture. "
                "Sound like replying to a friend's post, not manning a customer service desk."
            ),
            "banned_phrases": CUSTOMER_SERVICE_BANNED_PHRASES + XHS_CS_BANNED_PHRASES,
            "xhs_style_instruction": _XHS_STYLE_INSTRUCTION,
        }

    if platform_key == "tiktok":
        return {
            "platform_key": "tiktok",
            "style_name": "short_social_reply",
            "language_default": "zh-CN"
            if str(language or "").lower().startswith("zh")
            else "en",
            "tone": "short, punchy, memorable; low explanation; no customer-service tone",
            "max_reply_length": 60,
            "emoji_guidance": "0-1 emoji only if it feels native",
            "address_style": "direct and casual",
            "cultural_notes": "Lead with the point. Keep it conversational and easy to remember.",
            "banned_phrases": CUSTOMER_SERVICE_BANNED_PHRASES,
        }

    if platform_key in {"instagram", "facebook"}:
        return {
            "platform_key": platform_key,
            "style_name": "friendly_social_reply",
            "language_default": "en",
            "tone": "friendly, authentic, not too salesy",
            "max_reply_length": 80,
            "emoji_guidance": "0-2 emoji if natural",
            "address_style": "casual and warm",
            "cultural_notes": "Sound like a helpful brand operator, not a support macro.",
            "banned_phrases": CUSTOMER_SERVICE_BANNED_PHRASES,
        }

    return {
        "platform_key": "generic",
        "style_name": "natural_concise_helpful",
        "language_default": "en",
        "tone": "natural, concise, helpful",
        "max_reply_length": 75,
        "emoji_guidance": "optional, only if natural",
        "address_style": "casual and respectful",
        "cultural_notes": "No hard sell unless purchase intent is explicit.",
        "banned_phrases": CUSTOMER_SERVICE_BANNED_PHRASES,
    }
