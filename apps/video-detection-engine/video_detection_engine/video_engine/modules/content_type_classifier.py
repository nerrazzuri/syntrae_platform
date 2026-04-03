from typing import Tuple, Dict, List, Optional
from ..core.schemas import InputData, EmbeddingsBundle
from ..core.interfaces import IContentTypeClassifier

class HeuristicContentTypeClassifier(IContentTypeClassifier):
    
    TYPE_KEYWORDS = {
        "tutorial": ["how to", "tutorial", "guide", "step by step", "learn"],
        "review": ["review", "thoughts", "opinion", "rating", "test"],
        "before_after": ["before", "after", "results", "transformation"],
        "unboxing": ["unboxing", "unbox", "package", "opening"],
        "testimonial": ["love this", "changed my", "recommend", "obsessed"],
        "lifestyle": ["vlog", "day in my life", "morning routine", "grwm"],
        "demo": ["demo", "using", "apply", "try", "watch me"],
    }

    def classify(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Tuple[str, float, Dict[str, List[str]]]:
        signals = {
            "visual": [],
            "audio": [],
            "text_overlay": []
        }
        
        scores = {t: 0.0 for t in self.TYPE_KEYWORDS}
        
        all_text = (
            data.metadata.caption + " " + 
            "".join([s.text for s in data.audio_transcript.segments]) + " " + 
            " " + " ".join([o.text for o in data.ocr_texts])
        ).lower()
        
        for ctype, keywords in self.TYPE_KEYWORDS.items():
            for kw in keywords:
                if kw in all_text:
                    scores[ctype] += 1
                    # Trace signal (simplified)
                    transcript_text = "".join([s.text for s in data.audio_transcript.segments])
                    if kw in transcript_text.lower():
                        signals["audio"].append(kw)
                    if any(kw in s.text.lower() for s in data.ocr_texts):
                        signals["text_overlay"].append(kw)

        # Find max
        best_type = "unknown"
        max_score = 0
        
        for ctype, score in scores.items():
            if score > max_score:
                max_score = score
                best_type = ctype
        
        # Confidence
        confidence = min(0.9, 0.4 + (max_score * 0.15)) if max_score > 0 else 0.3
        
        return best_type, confidence, signals
