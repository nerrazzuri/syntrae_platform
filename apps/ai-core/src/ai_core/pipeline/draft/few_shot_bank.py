from __future__ import annotations

from copy import deepcopy


FEW_SHOTS: dict[str, dict[str, dict[str, list[dict[str, str]]]]] = {
    "zh": {
        "suitability_advice": {
            "bad": [
                {
                    "comment": "帮我看下我算哪种脸型，为什么我带猫眼这么大，感觉好奇怪，是衣服原因吗？",
                    "reply": "你好！猫眼眼镜确实会给脸型带来独特的感觉。可能与脸型和搭配的衣服都有关系。你希望找到更适合你脸型的眼镜吗？欢迎访问我们的店铺探索更多选择！",
                    "why": "Generic, evasive, and pushes the store before answering.",
                },
                {
                    "comment": "敏感肌可以用吗？我之前用酸类会泛红",
                    "reply": "可以放心使用，我们的产品适合所有肤质，欢迎进店了解更多。",
                    "why": "Unsafe overclaim and hard CTA instead of diagnostic caution.",
                },
                {
                    "comment": "三个月小猫可以吃吗？肠胃比较弱",
                    "reply": "可以的哦，欢迎购买我们的产品。",
                    "why": "Too absolute for a suitability/safety question.",
                },
            ],
            "good": [
                {
                    "comment": "帮我看下我算哪种脸型，为什么我带猫眼这么大，感觉好奇怪，是衣服原因吗？",
                    "reply": "不是你不适合猫眼，主要是这副框偏大、上扬角度也比较强，所以有点抢脸。衣服会有一点影响，换小一圈、线条柔和一点的猫眼会自然很多～",
                    "why": "Answers the real worry first with a concrete diagnosis.",
                },
                {
                    "comment": "敏感肌可以用吗？我之前用酸类会泛红",
                    "reply": "你这种情况建议先低频、局部试一下，尤其之前用酸类会泛红的话，不要一上来天天用～",
                    "why": "Gives cautious, specific guidance without selling.",
                },
                {
                    "comment": "三个月小猫可以吃吗？肠胃比较弱",
                    "reply": "三个月小猫肠胃比较弱的话，建议先少量试，观察便便和精神状态，别一开始就按正常量喂～",
                    "why": "Diagnostic and safe for a pet suitability question.",
                },
            ],
        },
        "purchase_request": {
            "bad": [
                {
                    "comment": "这个哪里买啊",
                    "reply": "感谢您的关注！请访问我们的店铺了解更多详情。",
                    "why": "Customer-service wording and too much distance.",
                }
            ],
            "good": [
                {
                    "comment": "这个哪里买啊",
                    "reply": "主页有链接～直接点进去就行！",
                    "why": "Direct, natural, and matches purchase intent.",
                }
            ],
        },
        "objection_or_concern": {
            "bad": [
                {
                    "comment": "感觉有点贵",
                    "reply": "我们的产品物超所值，欢迎了解更多！",
                    "why": "Dismisses the concern and sounds promotional.",
                }
            ],
            "good": [
                {
                    "comment": "感觉有点贵",
                    "reply": "可以先入小样试试～觉得适合再入正装，这样不踩雷",
                    "why": "Reduces risk with a practical next step.",
                }
            ],
        },
        "product_question": {
            "bad": [
                {
                    "comment": "有黑色款吗",
                    "reply": "有黑色款哦！不过选颜色也要结合你的肤色和穿搭风格，你平时穿搭什么风格？",
                    "why": "Answers but then deflects into irrelevant suitability/style questions.",
                },
                {
                    "comment": "可以配度数吗",
                    "reply": "可以配度数的，不过也要看脸型和个人风格，建议咨询客服了解更多～",
                    "why": "Mixes product capability with irrelevant suitability advice.",
                },
                {
                    "comment": "这款有近视夹片吗",
                    "reply": "这款没有近视夹片，不过可以根据你的脸型考虑其他适合的款式～",
                    "why": "Answers the product detail but adds unwanted suitability detour.",
                },
                {
                    "comment": "马来西亚可以寄吗",
                    "reply": "可以寄到马来西亚！另外这款很百搭，欢迎了解更多～",
                    "why": "Answers shipping but pads with a pointless upsell.",
                },
                {
                    "comment": "敏感肌可以用吗？我之前用酸类会泛红",
                    "reply": "可以放心使用，我们的产品适合所有肤质，欢迎进店了解更多。",
                    "why": "Unsafe overclaim and generic CTA.",
                },
            ],
            "good": [
                {
                    "comment": "有黑色款吗",
                    "reply": "有黑色款～主页详情页可以看各颜色选项。",
                    "why": "Direct factual answer only. No face-shape or styling advice.",
                },
                {
                    "comment": "可以配度数吗",
                    "reply": "配度数要看具体款式和镜片服务，建议以详情页或客服说明为准。",
                    "why": "Product capability question. Avoid unsupported promises.",
                },
                {
                    "comment": "这款有近视夹片吗",
                    "reply": "这款没有近视夹片。",
                    "why": "Answer the product detail directly. No extra styling advice.",
                },
                {
                    "comment": "马来西亚可以寄吗",
                    "reply": "可以寄到马来西亚，运费和时效以页面配送说明为准。",
                    "why": "Shipping question. Answer shipping directly.",
                },
                {
                    "comment": "敏感肌可以用吗？我之前用酸类会泛红",
                    "reply": "你这种情况建议先低频、局部试一下，尤其之前用酸类会泛红的话，不要一上来天天用～",
                    "why": "Answers with caution and specificity.",
                },
            ],
        },
    },
    "en": {
        "suitability_advice": {
            "bad": [
                {
                    "comment": "Would this work for oily skin?",
                    "reply": "Thank you for your interest! Our product is suitable for all skin types. Visit our store to learn more!",
                    "why": "Generic, overclaims, and pushes a store visit.",
                }
            ],
            "good": [
                {
                    "comment": "Would this work for oily skin?",
                    "reply": "It’s pretty lightweight, but if your T-zone gets oily fast, I’d start with a thin layer first and see how it sits through the day.",
                    "why": "Specific, practical, and not salesy.",
                }
            ],
        }
    },
}


def _language_group(language: str | None) -> str:
    normalized = str(language or "").strip().lower()
    if (
        normalized.startswith("zh")
        or "chinese" in normalized
        or "mandarin" in normalized
    ):
        return "zh"
    return "en"


def get_few_shots(
    language: str | None,
    reply_intent: str | None,
    platform: str | None = None,
    limit: int = 2,
) -> dict | None:
    del platform
    group = _language_group(language)
    intent = str(reply_intent or "").strip() or "general_interest"
    examples = FEW_SHOTS.get(group, {}).get(intent)
    if examples is None:
        return None

    capped = max(0, int(limit or 0))
    return {
        "bad": deepcopy(examples.get("bad", [])[:capped]),
        "good": deepcopy(examples.get("good", [])[:capped]),
    }
