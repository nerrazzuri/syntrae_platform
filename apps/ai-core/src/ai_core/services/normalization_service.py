
import re
import logging
import time
from typing import Dict, Any, Tuple, List
from dataclasses import asdict
from ai_core.data.normalization_rules import (
    SAFE_TOKEN_RULES, 
    PHRASE_RULES, 
    REGEX_RULES, 
    AMBIGUOUS_TOKENS, 
    STYLE_PARTICLES,
    NormalizationRule
)
from ai_core.pipeline.llm.llm_client import LLMClient

logger = logging.getLogger(__name__)

class NormalizationResult:
    def __init__(
        self, 
        raw_text: str, 
        normalized_text: str, 
        meta: Dict[str, Any]
    ):
        self.raw_text = raw_text
        self.normalized_text = normalized_text
        self.meta = meta
        # Convenience accessors for legacy/API
        self.confidence: float = meta.get("confidence", 0.0)
        self.method: str = meta.get("method", "UNKNOWN")
        self.language: str = meta.get("language_guess", "UNKNOWN")
        self.version: str = meta.get("version", "v1.1.0")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "normalized_text": self.normalized_text,
            "normalization_meta": self.meta
        }

class NormalizationService:
    VERSION = "v1.1.0"
    CONFIDENCE_THRESHOLD_ACCEPT = 0.6
    
    def __init__(self):
        self.llm_client = LLMClient()
    
    def normalize(self, text: str) -> NormalizationResult:
        """
        4-Layer Policy:
        1. Safe Tokens (always)
        2. Exact Phrases (high intent)
        3. Regex (cleanup)
        4. LLM (fallback)
        """
        start_time = time.time()
        
        if not text or not text.strip():
            return self._build_result(text, text, "NO_OP", 1.0, [], [], start_time, "UNKNOWN")

        current_text = text.lower() # basic case folding
        rules_fired = []
        warnings = []
        method = "DICT_SAFE" # Start optimistic
        confidence = 0.9     # Start optimistic
        
        # --- Layer 1 & 2: Deterministic Expansion ---
        # Strategy: 
        # 1. Apply Phrase Rules first (Greedy)
        # 2. Tokenize and apply Token Rules & Particles & Ambiguity Rules
        
        # 1. Phrase Rules
        for rule in PHRASE_RULES:
            pattern = r'\b' + re.escape(rule.pattern) + r'\b'
            if re.search(pattern, current_text):
                current_text = re.sub(pattern, rule.replacement, current_text)
                rules_fired.append(rule.id)
                method = "PHRASE_EXACT" # Upgrade method if phrase hit

        # 2. Token Processing
        # Split by whitespace for safety, handles basic punctuation
        # Ideally robust tokenizer, but split is consistent with rules for now
        tokens = re.split(r'(\W+)', current_text)
        new_tokens = []
        
        tokens_changed = 0
        
        for token in tokens:
            if not token.strip():
                new_tokens.append(token)
                continue
                
            processed = False
            
            # Check Ambiguity
            if token in AMBIGUOUS_TOKENS:
                # Special handling currently mainly for "x"
                if token == "x":
                    # Check context? For now, if "x" is standalone, we treat as "not" but warn or lower confidence?
                    # Spec says: "standalone token" -> "not". "xleh" handled by safe rule.
                    # Since we split on W+, "x" is isolated.
                    # Warning: AMBIGUOUS_NEGATION
                    new_tokens.append("not")
                    warnings.append("AMBIGUOUS_NEGATION")
                    confidence = min(confidence, 0.7) # Lower confidence due to risk
                    processed = True
                else:
                    warnings.append(f"AMBIGUOUS_TOKEN:{token}")
            
            # Check Particles
            if not processed and token in STYLE_PARTICLES:
                # Remove particle? Spec: "Remove or tag". 
                # Removing for cleaner embedding. 
                # e.g., "ok lah" -> "ok"
                # Check previous token? 
                processed = True # Drop it effectively by not appending? 
                # Actually, removing changes sentence structure slightly. 
                # Let's drop it but track it.
                warnings.append(f"PARTICLE_REMOVED:{token}")
                continue # Skip appending
                
            # Check Safe Rules
            if not processed:
                for rule in SAFE_TOKEN_RULES:
                    if rule.pattern == token:
                        new_tokens.append(rule.replacement)
                        rules_fired.append(rule.id)
                        tokens_changed += 1
                        processed = True
                        break
            
            if not processed:
                new_tokens.append(token)
                
        current_text = "".join(new_tokens)
        
        # --- Layer 3: Regex Cleanup ---
        for rule in REGEX_RULES:
             if re.search(rule.pattern, current_text):
                 match_count = len(re.findall(rule.pattern, current_text))
                 current_text = re.sub(rule.pattern, rule.replacement, current_text)
                 if match_count > 0:
                     rules_fired.append(rule.id)

        # Cleanup whitespace
        current_text = re.sub(r'\s+', ' ', current_text).strip()
        
        # --- Language Detection ---
        lang = self._detect_language(text) # Check original text for markers
        
        # --- Layer 4: LLM Fallback ---
        # Triggers: 
        # 1. Mixed language detected
        # 2. Warnings present (e.g., Ambiguity)
        # 3. Low initial confidence (handled via logic)
        
        use_llm = False
        if lang == "MIXED":
            use_llm = True
        if warnings:
            use_llm = True # Valid strategy? Or does ambiguity imply LLM might solve it?
            # User spec: "Unknown token ratio > threshold, Ambiguity warnings present"
            
        if use_llm:
            try:
                llm_text, llm_conf = self._layer4_llm(text) # Normalize Raw again? Or current?
                # Spec: "Input: Raw Text + Optional Layer 1". 
                # Let's pass Raw for context, but maybe Current as hint? Raw is safest to avoid compounding errors.
                # Actually, user spec says "Input: Raw text".
                
                # Check constraints (Edit Distance / Distortion)
                # Simple check: Length ratio? 
                if len(llm_text) > len(text) * 2.5: # Hallucination check
                     warnings.append("LLM_LENGTH_SPIKE")
                     # Discard LLM
                else:
                    current_text = llm_text
                    confidence = llm_conf
                    method = "LLM"
                    rules_fired.append("LLM_FALLBACK")
            except Exception as e:
                logger.error(f"LLM Fallback failed: {e}")
                method = "FALLBACK"
                confidence = 0.5
                warnings.append("LLM_FAILURE")

        return self._build_result(text, current_text, method, confidence, rules_fired, warnings, start_time, lang)

    def _build_result(self, raw, norm, method, conf, rules, warnings, start_time, lang):
        meta = {
            "version": self.VERSION,
            "method": method,
            "confidence": conf,
            "rules_fired": list(set(rules)), # Dedupe
            "warnings": warnings,
            "language_guess": lang,
            "latency_ms": int((time.time() - start_time) * 1000),
            "chars_changed": abs(len(norm) - len(raw))
        }
        return NormalizationResult(raw, norm, meta)

    def _detect_language(self, text: str) -> str:
        # Reusing previous logic, imported markers
        from ai_core.data.normalization_rules import MS_MARKERS, EN_MARKERS
        
        tokens = set(re.findall(r"\b\w+\b", text.lower()))
        if not tokens: return "UNKNOWN"
        
        ms_hits = len(tokens.intersection(MS_MARKERS))
        en_hits = len(tokens.intersection(EN_MARKERS))
        zh_count = len(re.findall(r'[\u4e00-\u9fff]', text))
        
        if zh_count > 0: return "ZH" if (ms_hits==0 and en_hits==0) else "MIXED"
        if ms_hits > 0 and en_hits > 0: return "MIXED"
        if ms_hits > en_hits: return "MS"
        if en_hits > ms_hits: return "EN"
        return "UNKNOWN"

    def _layer4_llm(self, text: str) -> Tuple[str, float]:
        prompt = (
            f"Normalize the following Malaysian social media comment into clear, standard English.\n"
            f"Expand slang/short-forms. Preserve meaning.\n"
            f"Do NOT infer intent. Do NOT add information. Output ONLY the normalized text.\n\n"
            f"Input: {text}"
        )
        
        response = self.llm_client.generate(
            query=prompt,
            contexts=[],
            intent="normalization",
            generation_config={
                "max_tokens": 128,
                "temperature": 0.0
            }
        )
        t = response.get("text", "").strip()
        if not t: raise ValueError("Empty LLM")
        return t, 0.85 # Heuristic confidence for LLM
