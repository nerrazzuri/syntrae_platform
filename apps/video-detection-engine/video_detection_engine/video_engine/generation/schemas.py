from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel, Field

class GenerationMode(str, Enum):
    REPLY = "reply"
    DM = "dm"

class MessageTemplateType(str, Enum):
    PURCHASE_LINK = "purchase_link"
    PURCHASE_INFO = "purchase_info" 
    INQUIRY_ANSWER = "inquiry_answer"
    OBJECTION_HANDLING = "objection_handling"
    COMPARISON = "comparison"
    GENERIC_HELP = "generic_help"
    NONE = "none"

class MessageAudit(BaseModel):
    generator_version: str = "1.0"
    llm_used: bool = False
    policy_version: str = "1.0"
    risk_policy_version: str = "1.0"

class MessageResult(BaseModel):
    """
    Final Output of Phase 8.
    """
    message_text: str
    message_language: str
    used_templates: List[str] = Field(default_factory=list)
    used_knowledge_refs: List[str] = Field(default_factory=list)
    safety_flags: List[str] = Field(default_factory=list)
    audit: MessageAudit

class GenerationConfig(BaseModel):
    """
    Configuration for generation engine.
    """
    tenant_id: str
    enable_llm: bool = False
    max_length_reply: int = 200
    max_length_dm: int = 500
    allowed_languages: List[str] = ["en"]
    default_language: str = "en"
    # Basic templates for Track A (Simulated)
    templates: Dict[MessageTemplateType, str] = {
        MessageTemplateType.PURCHASE_LINK: "Here is the link: {url}",
        MessageTemplateType.PURCHASE_INFO: "The price is {price}. {details}",
        MessageTemplateType.INQUIRY_ANSWER: "Thanks for asking! {answer}",
        MessageTemplateType.OBJECTION_HANDLING: "We hear you. Actually {correction}",
        MessageTemplateType.COMPARISON: "{my_product} features {feature}, unlike others.",
        MessageTemplateType.GENERIC_HELP: "Check our bio for more info!"
    }
