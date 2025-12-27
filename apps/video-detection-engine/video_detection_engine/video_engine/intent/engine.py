from typing import List, Optional, Tuple, Dict
import re

from .schemas import CommentData, IntentResult, IntentType
from .spam_gate import SpamGate
from ..core.schemas import DetectionResult

class CommentIntentEngine:
    """
    Phase 4: Classifies comment intent based on text and video context.
    
    Gates:
    1. Video Eligibility (Must be Commercial)
    2. Minimum Length
    3. Spam Check
    
    Logic:
    - Heuristic Keyword Matching (Deterministic)
    - Context Fusion (Niche/Type/Confidence)
    - Actionability Rules
    """
    
    def __init__(self, config=None):
        self.config = config # store thresholds here if needed
        self.spam_gate = SpamGate()
        
        # Configuration Defaults
        self.COMM_LOW = 0.2
        self.INTENT_HIGH = 0.8
        self.MIN_LENGTH = 3
        
        # Intent Archetypes (Heuristic Keywords)
        self.KEYWORDS = {
            IntentType.PURCHASE: [
                "buy", "price", "cost", "how much", "link", "where to get", "purchase", 
                "ordering", "shipping", "promo code", "discount", "sale"
            ],
            IntentType.INQUIRY: [
                "how do i", "can i", "does this", "what is", "help", "question", 
                "info", "details", "size", "color"
            ],
            IntentType.OBJECTION: [
                "expensive", "pricy", "too much", "shipping is high", "broken", 
                "scam", "fake", "bad quality", "trash", "waste"
            ],
            IntentType.COMPARISON: [
                "better than", "verse", "vs", "compared to", "alternative", "dupe"
            ],
            IntentType.PRAISE: [
                "love", "amazing", "great", "cool", "want", "need", "best", "awesome",
                "beautiful", "pretty"
            ],
            IntentType.NEGATIVE: [
                "hate", "ugly", "boring", "stupid", "worst", "stop"
            ]
        }
        
    def process(self, comment: CommentData, detection: DetectionResult) -> IntentResult:
        try:
            return self._unsafe_process(comment, detection)
        except Exception as e:
            # L1 Failure Handling
            niche = detection.niche if detection.is_commercial_content else "other.consumer"
            return IntentResult(
                comment_id=comment.id,
                is_actionable=False,
                intent_type=IntentType.UNKNOWN,
                intent_confidence=0.0,
                related_niche=niche,
                signals_used={"text": [], "context": [f"error:internal:{str(e)}"]}
            )

    def _unsafe_process(self, comment: CommentData, detection: DetectionResult) -> IntentResult:
        signals = {"text": [], "context": []}
        
        # --- Gate 1: Video Eligibility ---
        if not detection.is_commercial_content:
            return self._unknown_result(comment, "video_not_commercial", detection)

        if detection.commercial_confidence < self.COMM_LOW:
            return self._unknown_result(comment, "video_low_commercial_conf", detection)

        # --- Gate 2: Minimum Length & Emoji Gate ---
        import regex # Or use re if available. Standard re supports limited emoji.
        # Simple heuristic: remove emojis, check length.
        # Or check if [a-zA-Z0-9] exists.
        
        # C2: Emoji-only check
        # If removing all non-emoji chars leaves empty string -> Emoji only.
        # Better: check for at least some alphanumeric.
        clean_text = re.sub(r"[^a-zA-Z0-9\s]", "", comment.text).strip()
        
        if len(comment.text.strip()) < self.MIN_LENGTH:
             return self._unknown_result(comment, "comment_too_short", detection)
             
        if not clean_text and len(comment.text.strip()) > 0:
             # C2: Emoji/Punc only
             return self._unknown_result(comment, "comment_emoji_only", detection)
             
        # --- Gate 3: Spam Gate ---
        is_spam, spam_reasons = self.spam_gate.is_spam(comment.text)
        if is_spam:
            signals["text"].extend(spam_reasons)
            return IntentResult(
                comment_id=comment.id,
                is_actionable=False,
                intent_type=IntentType.SPAM,
                intent_confidence=1.0, 
                related_niche=detection.niche,
                signals_used=signals
            )

        # --- Core Logic: Intent Classification ---
        
        # 1. Normalize
        text_lower = comment.text.lower()
        
        # 2. Keyword Matching
        intent_scores = {t: 0.0 for t in IntentType if t not in [IntentType.SPAM, IntentType.UNKNOWN]}
        
        # Define strong keywords that immediately trigger high confidence
        STRONG_CONTAINMENT = ["better than", "link", "buy", "price", "fake", "scam", "how much", "where to"]

        for i_type, keywords in self.KEYWORDS.items():
            for kw in keywords:
                if kw in text_lower:
                    weight = 2.0 if kw in STRONG_CONTAINMENT else 1.0
                    intent_scores[i_type] += weight
                    signals["text"].append(f"kw:{kw}")
        
        # 3. Context Fusion
        if detection.content_type in ["review", "demo", "unboxing"]:
            if intent_scores[IntentType.PURCHASE] > 0:
                intent_scores[IntentType.PURCHASE] += 0.5
                signals["context"].append("boost:ct_commercial")
                
        # 4. Determine Winner
        best_intent = IntentType.UNKNOWN
        max_score = 0
        
        for i_type, score in intent_scores.items():
            if score > max_score:
                max_score = score
                best_intent = i_type
        
        # 5. Confidence Calculation
        confidence = 0.0
        if max_score >= 2:
            confidence = 0.95
        elif max_score >= 1:
            confidence = 0.70
        else:
            confidence = 0.0
            best_intent = IntentType.UNKNOWN

        # --- Actionability Policy ---
        actionable_intents = [
            IntentType.PURCHASE, 
            IntentType.INQUIRY, 
            IntentType.OBJECTION, 
            IntentType.COMPARISON
        ]
        
        is_actionable = (
            best_intent in actionable_intents 
            and confidence >= self.INTENT_HIGH
        )
        
        return IntentResult(
            comment_id=comment.id,
            is_actionable=is_actionable,
            intent_type=best_intent,
            intent_confidence=confidence,
            related_niche=detection.niche,
            signals_used=signals
        )

    def _unknown_result(self, comment: CommentData, reason: str, detection: DetectionResult) -> IntentResult:
        # Helper for early exits
        niche = detection.niche if detection.is_commercial_content else "other.consumer"
        return IntentResult(
            comment_id=comment.id,
            is_actionable=False,
            intent_type=IntentType.UNKNOWN,
            intent_confidence=0.0,
            related_niche=niche,
            signals_used={"text": [], "context": [f"gate:{reason}"]}
        )
