from typing import Tuple, Dict, List, Optional
from ..core.schemas import InputData, EmbeddingsBundle
from ..core.interfaces import ICommercialGate

class HeuristicCommercialGate(ICommercialGate):
    """
    A rule-based implementation of the Commercial Gate.
    In a real system, this would use a trained classifier on embeddings.
    Here, we search for 'commercial' keywords in text/OCR/ASR.
    """
    
    COMMERCIAL_KEYWORDS = {
        "price", "buy", "shop", "discount", "sale", "code", "link", "review", 
        "routine", "my favorite", "unboxing", "haul", "get ready with me", "grwm",
        "try on", "swatch", "best", "top", "recommend", "ad", "sponsored"
    }

    def assess(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Tuple[bool, float, Dict[str, List[str]]]:
        signals = {
            "visual": [],
            "audio": [],
            "text_overlay": []
        }
        
        score = 0.0
        
        # Check OCR
        for artifact in data.ocr_texts:
            lower_text = artifact.text.lower()
            for kw in self.COMMERCIAL_KEYWORDS:
                if kw in lower_text:
                    score += 0.2
                    signals["text_overlay"].append(kw)
        
        # Check Audio Transcript
        lower_transcript = "".join([s.text for s in data.audio_transcript.segments]).lower()
        for kw in self.COMMERCIAL_KEYWORDS:
            if kw in lower_transcript:
                score += 0.15
                signals["audio"].append(kw)
                
        # Check Caption
        lower_caption = data.metadata.caption.lower()
        for kw in self.COMMERCIAL_KEYWORDS:
            if kw in lower_caption:
                score += 0.1
                # Captions are technically text_overlay or metadata, but we'll trace them as text_overlay for now or just ignore trace mapping strictness for metadata
                # The spec asks for visual/audio/text_overlay. Let's map caption matches to text_overlay akin to "OCR" of description
                signals["text_overlay"].append(f"caption:{kw}")

        # Normalize score
        confidence = min(1.0, score)
        is_commercial = confidence > 0.3  # Threshold
        
        return is_commercial, confidence, signals
