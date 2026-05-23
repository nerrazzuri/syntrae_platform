from __future__ import annotations

import json
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from ai_core.pipeline.draft.draft_qc import DraftQualityChecker
from ai_core.pipeline.draft.few_shot_bank import get_few_shots
from ai_core.pipeline.llm.llm_client import LLMClient
from ai_core.services.domain_profile_service import build_brand_reply_profile
from ai_core.services.reply_strategy_adapter import adapt_reply_strategy
from ai_core.services.reply_style_profiles import get_platform_style
from shared.database.models import BuyerStage, LeadOpportunity, RecommendedAction

PROMPT_VERSION = "v2_strategy_platform_profile"


def temperature_for_reply_intent(
    reply_intent: str | None, is_rewrite: bool = False
) -> float:
    if is_rewrite:
        return 0.5

    normalized = str(reply_intent or "").strip().lower()
    if normalized in {
        "complaint_or_negative",
        "safety_suitability",
        "product_claim",
        "unsafe_or_overclaim",
    } or any(token in normalized for token in ("safety", "unsafe", "claim", "risk")):
        return 0.5
    if normalized in {"product_question", "purchase_request"}:
        return 0.62
    if normalized == "suitability_advice":
        return 0.78
    if normalized in {"compliment_or_interest", "general_interest"}:
        return 0.82
    return 0.7


class DraftGenerationService:
    def __init__(
        self,
        db: Session,
        llm_client: LLMClient,
        draft_qc: DraftQualityChecker | None = None,
    ):
        self.db = db
        self.llm_client = llm_client
        self.draft_qc = draft_qc or DraftQualityChecker()

    def _value_name(self, value: Any) -> str:
        if value is None:
            return ""
        return str(getattr(value, "name", value))

    def _check_eligibility(self, lead: LeadOpportunity) -> bool:
        if self._value_name(lead.buyer_stage) == BuyerStage.AWARENESS.name:
            return False
        if (
            self._value_name(lead.recommended_action)
            == RecommendedAction.SILENT_CAPTURE.name
        ):
            return False
        return True

    def _detect_language(
        self, comment_text: str, preferred_language: Optional[str]
    ) -> str:
        if preferred_language:
            normalized = preferred_language.lower()
            if normalized in {
                "zh",
                "zh-cn",
                "chinese",
                "mandarin",
                "simplified chinese",
            }:
                return "Mandarin Chinese (Simplified)"
            if normalized in {"en", "english"}:
                return "English"

        if re.search(r"[\u4e00-\u9fff]", comment_text or ""):
            return "Mandarin Chinese (Simplified)"
        return "English"

    def _dedupe(self, values: list[Any]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            if not isinstance(value, str):
                continue
            stripped = value.strip()
            if not stripped:
                continue
            key = stripped.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(stripped)
        return result

    def _json_preview(self, value: Any, fallback: str = "N/A") -> str:
        if value in (None, {}, []):
            return fallback
        try:
            return json.dumps(value, ensure_ascii=False, indent=2, default=str)
        except TypeError:
            return str(value)

    def _extract_brand_reply_profile(
        self, owner_settings: dict[str, Any]
    ) -> dict[str, Any]:
        for key in ("brand_reply_profile", "brand_domain_profile", "domain_context"):
            value = owner_settings.get(key)
            if isinstance(value, dict):
                return value
        return {}

    def _format_product_context(self, product_context: Any) -> tuple[str, bool]:
        if not isinstance(product_context, dict) or not product_context.get("name"):
            return "N/A", False

        benefits = product_context.get("key_benefits") or []
        objections = product_context.get("common_objections") or []
        product_context_text = (
            f"Name: {product_context.get('name')}; "
            f"Category: {product_context.get('category') or 'N/A'}; "
            f"Description: {product_context.get('description') or 'N/A'}; "
            f"Price: {product_context.get('price_label') or 'N/A'}; "
            f"Target Buyer: {product_context.get('target_buyer') or 'N/A'}; "
            f"Benefits: {', '.join(benefits) if isinstance(benefits, list) else 'N/A'}; "
            f"Objections: {', '.join(objections) if isinstance(objections, list) else 'N/A'}; "
            f"CTA URL: {product_context.get('cta_url') or 'N/A'}"
        )
        return product_context_text, True

    def _format_knowledge_context(
        self, knowledge_context: Any
    ) -> tuple[str, bool, int]:
        if not isinstance(knowledge_context, list) or not knowledge_context:
            return "N/A", False, 0

        lines = []
        for item in knowledge_context[:3]:
            if not isinstance(item, dict):
                continue
            title = item.get("document_title") or "Imported knowledge"
            content = str(item.get("content") or "").strip()
            if content:
                lines.append(f"{title}: {content[:240]}")

        if not lines:
            return "N/A", False, 0
        return "\n".join(lines), True, min(len(lines), 3)

    def _format_few_shots(self, few_shots: dict | None) -> str:
        if not few_shots:
            return "N/A"

        lines: list[str] = []
        for label in ("bad", "good"):
            examples = few_shots.get(label) or []
            if not examples:
                continue
            lines.append(f"{label.upper()} examples:")
            for example in examples:
                lines.append(f"- Comment: {example.get('comment', '')}")
                lines.append(f"  Reply: {example.get('reply', '')}")
                why = example.get("why")
                if why:
                    lines.append(f"  Why: {why}")
        return "\n".join(lines) if lines else "N/A"

    def _brand_principles(self, brand_reply_profile: dict[str, Any]) -> str:
        principles = brand_reply_profile.get("reply_principles")
        if isinstance(principles, list):
            return "\n".join(f"- {item}" for item in principles if item)
        if isinstance(principles, str) and principles.strip():
            return f"- {principles.strip()}"
        return "- Keep the reply concrete, natural, and directly useful."

    def _product_grounding_instruction(self, product_grounding_mode: str) -> str:
        instructions = {
            "product_first": (
                "Product information can be the main answer. If strategy allows "
                "redirect, a soft CTA is acceptable."
            ),
            "answer_from_product": (
                "先回答产品/功能/规格问题；有 product_context / knowledge_context 时优先使用，"
                "但不要超出已有信息。"
            ),
            "diagnostic_then_product_support": (
                "先诊断用户情况，再给建议；产品信息只能作为支持，不要强行推荐；" "除非用户问产品，不要用产品名开头。"
            ),
            "instruction_then_product_support": ("先给使用/行动指导；只有产品细节能让步骤更清楚时才提产品。"),
            "concern_first_product_support": ("先承接并降低用户顾虑；产品信息只能用来支持解释，避免硬卖。"),
            "repair_first_no_sell": "不要销售；先承认问题，并给出修复/协助路径。",
            "light_optional": "产品提及是可选的，只在自然时轻轻带到。",
            "none": "不要使用 product_context 或 knowledge_context。",
        }
        return instructions.get(product_grounding_mode, instructions["light_optional"])

    def _build_system_prompt(
        self,
        brand_name: str,
        platform_style: dict[str, Any],
        strategy: dict[str, Any],
        brand_reply_profile: dict[str, Any] | None = None,
    ) -> str:
        brand_reply_profile = brand_reply_profile or {}
        forbidden_phrases = self._dedupe(
            list(strategy.get("forbidden_phrases") or [])
            + list(platform_style.get("banned_phrases") or [])
        )
        forbidden_text = "\n".join(f"- {phrase}" for phrase in forbidden_phrases)

        return f"""你是「{brand_name}」的社交媒体运营。

你的回复会被真人审核后公开发布。
你要像真实用户/真实运营一样自然回复，不要像客服机器人。

平台风格：
- {platform_style.get("tone")}
- {platform_style.get("cultural_notes")}
- Emoji: {platform_style.get("emoji_guidance")}
- Addressing: {platform_style.get("address_style")}

品牌原则：
{self._brand_principles(brand_reply_profile)}

绝对不要使用：
{forbidden_text}

重要：
- 不要用「当然」「非常感谢」「我理解你的感受」这类 AI/客服式开头。
- 不要每句话都完整、对称、像客服说明；真实评论区回复可以更短、更直接。
- 先回答用户真正问的问题，再决定要不要追问。
- 如果回复策略 should_redirect=false，不要导购，不要叫用户进店，不要引导购买。
- 如果不确定产品细节，不要编造，宁愿跳过。
- 不要暗示亲身使用体验，除非品牌资料明确支持。
- 直接输出回复文本，不要解释。"""

    def _build_user_prompt(
        self,
        *,
        comment_text: str,
        original_intent: str,
        buyer_stage: str,
        strategy: dict[str, Any],
        brand_name: str,
        brand_domain: str,
        brand_reply_profile: dict[str, Any],
        product_context_text: str,
        knowledge_context_text: str,
        few_shots: dict | None,
        language: str,
        platform_style: dict[str, Any],
        tone: str,
        cta_target_human: str,
    ) -> str:
        compact_strategy = {
            "reply_intent": strategy.get("reply_intent"),
            "reply_mode": strategy.get("reply_mode"),
            "should_redirect": strategy.get("should_redirect"),
            "cta_strength": strategy.get("cta_strength"),
            "require_diagnostic": strategy.get("require_diagnostic"),
            "require_specific_answer": strategy.get("require_specific_answer"),
            "product_grounding_mode": strategy.get("product_grounding_mode"),
            "suggested_focus": strategy.get("suggested_focus"),
        }

        extra_instructions = []
        suggested_focus = strategy.get("suggested_focus")
        if suggested_focus:
            extra_instructions.append(f"回复重点：{suggested_focus}")
        product_grounding_mode = (
            strategy.get("product_grounding_mode") or "light_optional"
        )
        extra_instructions.append(
            "产品知识边界：" + self._product_grounding_instruction(str(product_grounding_mode))
        )
        if not strategy.get("should_redirect"):
            extra_instructions.append("这条回复不需要导购或 CTA，专注回答用户问题。")
        if strategy.get("reply_intent") == "suitability_advice":
            extra_instructions.append("这类评论要像顾问一样先给判断/诊断，再给建议。不要硬卖。最多问一个简短追问。")
        if strategy.get("reply_intent") == "purchase_request":
            extra_instructions.append("用户已经表达购买/链接/价格意图，可以直接回答，并允许自然软 CTA。")

        return f"""Generate one public social-media reply.

Original comment:
{comment_text or "N/A"}

Original intent: {original_intent or "N/A"}
Buyer stage: {buyer_stage or "N/A"}
Tone setting: {tone}

Reply strategy:
{self._json_preview(compact_strategy)}

Brand:
- Name: {brand_name}
- Domain: {brand_domain or "N/A"}

Brand reply profile summary:
{self._json_preview(brand_reply_profile)}

Product context:
{product_context_text}

Knowledge context:
{knowledge_context_text}

Few-shot guidance:
{self._format_few_shots(few_shots)}

Language requirement:
- Reply in {language}.
- Match the original comment's language when possible.

Length and platform:
- Maximum length: {platform_style.get("max_reply_length")} characters/words depending on language.
- Platform style: {platform_style.get("style_name")}

CTA context:
- Allowed target if strategy permits redirect: {cta_target_human}

Product/knowledge context rule:
- Product grounding mode: {product_grounding_mode}.
- Follow the product grounding boundary above.
- Do not force product recommendation when strategy.should_redirect is false.

Additional instructions:
{chr(10).join(f"- {item}" for item in extra_instructions) if extra_instructions else "- Be specific, natural, and concise."}

Output only the reply text."""

    def _clean_reply_text(self, response_text: str) -> str:
        text = response_text.strip()
        if len(text) >= 2 and text.startswith('"') and text.endswith('"'):
            return text[1:-1].strip()
        return text

    def _build_rewrite_prompt(
        self,
        *,
        original_user_prompt: str,
        failed_draft: str,
        qc_result: dict[str, Any],
        strategy: dict[str, Any],
    ) -> str:
        flag_lines = []
        for flag in qc_result.get("flags") or []:
            if not isinstance(flag, dict):
                continue
            evidence = flag.get("evidence")
            evidence_text = f" Evidence: {evidence}" if evidence else ""
            flag_lines.append(
                f"- {flag.get('type')}: {flag.get('message')}{evidence_text}"
            )

        if not flag_lines:
            flag_lines.append(
                "- QUALITY_CHECK_FAILED: Rewrite to be more natural and concrete."
            )

        no_cta_rule = ""
        if not strategy.get("should_redirect"):
            no_cta_rule = (
                "- If should_redirect=false, do not include "
                "CTA/store/link/private-message language."
            )

        return f"""The previous draft failed quality checks.

Original task:
{original_user_prompt}

Failed draft:
{failed_draft}

Quality issues:
{chr(10).join(flag_lines)}

Rewrite the reply.
Requirements:
- Keep the same reply strategy: {strategy.get("reply_intent")} / {strategy.get("reply_mode")}
{no_cta_rule}
- Remove AI/customer-service phrasing.
- Be concrete and natural.
- Output only the rewritten public reply text."""

    def _qc_flag_types(self, qc_result: dict[str, Any]) -> list[str]:
        flag_types: list[str] = []
        for flag in qc_result.get("flags") or []:
            if isinstance(flag, dict) and isinstance(flag.get("type"), str):
                flag_types.append(flag["type"])
        return flag_types

    def _merge_risk_flags(
        self,
        strategy: dict[str, Any],
        qc_result: dict[str, Any],
    ) -> list[str]:
        flags = list(strategy.get("risk_flags") or [])
        if not qc_result.get("passed"):
            flags.extend(self._qc_flag_types(qc_result))
        return self._dedupe(flags)

    def generate_draft(
        self,
        lead_id: str,
        account_id: str,
        force: bool = False,
        owner_settings: dict | None = None,
    ) -> dict[str, Any]:
        # TODO: force is preserved for API compatibility. Idempotency remains owned by operator-api / future draft persistence flow.
        _ = force
        lead = (
            self.db.query(LeadOpportunity)
            .filter(
                LeadOpportunity.id == lead_id, LeadOpportunity.account_id == account_id
            )
            .first()
        )

        if not lead:
            raise ValueError("Lead not found or access denied")

        if not self._check_eligibility(lead):
            raise ValueError("Lead not eligible for draft generation")

        owner_settings = owner_settings or {}
        tone = owner_settings.get("tone", "professional")
        comment_text = owner_settings.get("comment_text") or ""
        language = self._detect_language(
            comment_text, owner_settings.get("preferred_language")
        )
        reply_redirect_target = owner_settings.get("reply_redirect_target", "STORE")
        brand_name = owner_settings.get("brand_name") or "the brand"
        brand_domain = owner_settings.get("brand_domain") or ""
        product_context = owner_settings.get("product_context") or {}
        knowledge_context = owner_settings.get("knowledge_context") or []
        brand_reply_profile = build_brand_reply_profile(
            brand_name=brand_name,
            brand_domain=brand_domain,
            product_context=product_context,
            knowledge_context=knowledge_context,
            existing_profile=self._extract_brand_reply_profile(owner_settings),
            owner_settings=owner_settings,
        )

        product_context_text, _has_product_context = self._format_product_context(
            product_context
        )
        (
            knowledge_context_text,
            _has_knowledge_context,
            _catalog_suggestion_count,
        ) = self._format_knowledge_context(knowledge_context)

        platform = getattr(lead, "platform", None) or owner_settings.get("platform")
        buyer_stage = self._value_name(
            getattr(lead, "buyer_stage", None)
        ) or owner_settings.get("buyer_stage")
        original_intent = owner_settings.get("intent") or getattr(lead, "intent", None)

        strategy = adapt_reply_strategy(
            intent=original_intent,
            buyer_stage=buyer_stage,
            confidence=getattr(lead, "confidence", None),
            risk_level=getattr(lead, "risk_level", None),
            platform=platform,
            comment_text=comment_text,
            product_context=product_context,
            brand_reply_profile=brand_reply_profile,
            owner_settings=owner_settings,
        )
        platform_style = get_platform_style(platform, language)
        few_shots = get_few_shots(
            language=language,
            reply_intent=strategy.get("reply_intent"),
            platform=platform,
            limit=2,
        )

        cta_map = {
            "STORE": "the brand's store",
            "PROFILE": "the brand's profile",
            "PINNED_POST": "the brand's pinned post",
            "CUSTOMER_SERVICE": "the brand's customer service entrypoint",
        }
        cta_target_human = cta_map.get(reply_redirect_target, "the brand's store")

        system_prompt = self._build_system_prompt(
            brand_name=brand_name,
            platform_style=platform_style,
            strategy=strategy,
            brand_reply_profile=brand_reply_profile,
        )
        user_prompt = self._build_user_prompt(
            comment_text=comment_text,
            original_intent=str(original_intent or ""),
            buyer_stage=str(buyer_stage or ""),
            strategy=strategy,
            brand_name=brand_name,
            brand_domain=brand_domain,
            brand_reply_profile=brand_reply_profile,
            product_context_text=product_context_text,
            knowledge_context_text=knowledge_context_text,
            few_shots=few_shots,
            language=language,
            platform_style=platform_style,
            tone=tone,
            cta_target_human=cta_target_human,
        )

        try:
            response_text = self.llm_client.chat_completion(
                messages=[{"role": "user", "content": user_prompt}],
                temperature=temperature_for_reply_intent(strategy.get("reply_intent")),
                system_message=system_prompt,
            )

            draft_text = self._clean_reply_text(response_text)
            qc_result = self.draft_qc.check(
                draft_text=draft_text,
                comment_text=comment_text,
                strategy=strategy,
                platform_style=platform_style,
                brand_reply_profile=brand_reply_profile,
            )

            rewrite_attempted = False
            final_qc_result = qc_result
            if not qc_result.get("passed"):
                rewrite_attempted = True
                rewrite_prompt = self._build_rewrite_prompt(
                    original_user_prompt=user_prompt,
                    failed_draft=draft_text,
                    qc_result=qc_result,
                    strategy=strategy,
                )
                rewrite_response_text = self.llm_client.chat_completion(
                    messages=[{"role": "user", "content": rewrite_prompt}],
                    temperature=temperature_for_reply_intent(
                        strategy.get("reply_intent"), is_rewrite=True
                    ),
                    system_message=system_prompt,
                )
                rewritten_text = self._clean_reply_text(rewrite_response_text)
                rewrite_qc_result = self.draft_qc.check(
                    draft_text=rewritten_text,
                    comment_text=comment_text,
                    strategy=strategy,
                    platform_style=platform_style,
                    brand_reply_profile=brand_reply_profile,
                )

                if rewrite_qc_result.get("passed") or rewrite_qc_result.get(
                    "score", 0
                ) > qc_result.get("score", 0):
                    draft_text = rewritten_text
                    final_qc_result = rewrite_qc_result

            should_redirect = bool(strategy.get("should_redirect"))
            strategy_meta = {
                "reply_mode": strategy.get("reply_mode"),
                "should_redirect": should_redirect,
                "cta_strength": strategy.get("cta_strength"),
                "require_diagnostic": strategy.get("require_diagnostic", False),
            }

            return {
                "draft_text": draft_text,
                "tone": tone,
                "language": language,
                "source_language": language,
                "prompt_version": PROMPT_VERSION,
                "cached": False,
                "cta_target": reply_redirect_target if should_redirect else "NONE",
                "cta_label": cta_target_human if should_redirect else None,
                "reply_strategy": strategy.get("reply_intent") or "general_interest",
                "risk_flags": self._merge_risk_flags(strategy, final_qc_result),
                "human_review_required": True,
                "strategy_meta": strategy_meta,
                "qc_status": final_qc_result,
                "rewrite_attempted": rewrite_attempted,
            }

        except Exception as e:
            raise RuntimeError(f"LLM generation failed: {str(e)}")
