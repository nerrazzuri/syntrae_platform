from typing import Tuple, Dict, List, Optional
from ..core.schemas import InputData, EmbeddingsBundle
from ..core.interfaces import INicheClassifier

class HeuristicNicheClassifier(INicheClassifier):
    
    NICHE_KEYWORDS = {
        "beauty.makeup": ["lipstick", "foundation", "mascara", "eyeliner", "blush", "makeup", "swatch", "shade"],
        "beauty.skincare": ["serum", "moisturizer", "cleanser", "sunscreen", "acne", "skin", "routine"],
        "beauty.hair": ["shampoo", "conditioner", "curl", "hair", "styling", "dryer"],
        "fashion.accessory": ["bag", "shoes", "jewelry", "necklace", "ring", "watch", "outfit", "style"],
        "pets": ["dog", "cat", "pet", "toy", "food", "treat", "leash"],
        "home.gadget": ["cleaner", "vacuum", "kitchen", "organizer", "gadget", "hack"],
        "fitness": ["workout", "gym", "protein", "yoga", "fitness", "run"],
        "food.snack": ["snack", "eat", "taste", "drink", "recipe", "cook"],
        "digital.product": ["app", "course", "ebook", "software", "download"],
    }
    
    def classify(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Tuple[str, str, float, Dict[str, List[str]]]:
        signals = {
            "visual": [],
            "audio": [],
            "text_overlay": []
        }
        
        scores = {niche: 0.0 for niche in self.NICHE_KEYWORDS}
        
        
        # Combine all text
        transcript_text = " ".join([seg.text for seg in data.audio_transcript.segments])
        ocr_text = " ".join([ocr.text for ocr in data.ocr_texts])
        
        all_text = (
            data.metadata.caption + " " + 
            transcript_text + " " + 
            ocr_text
        ).lower()
        
        # Very simple keyword counting
        for niche, keywords in self.NICHE_KEYWORDS.items():
            for kw in keywords:
                if kw in all_text:
                    scores[niche] += 1
                    # Just attributing to audio for simplicity in this aggregate check, 
                    # generic implementation would be more precise
                    if kw in transcript_text.lower():
                        signals["audio"].append(kw)
                    if any(kw in s.text.lower() for s in data.ocr_texts):
                        signals["text_overlay"].append(kw)

        # Find max
        best_niche = "other.consumer"
        max_score = 0
        
        for niche, score in scores.items():
            if score > max_score:
                max_score = score
                best_niche = niche
        
        # Confidence logic
        confidence = min(0.9, 0.5 + (max_score * 0.1)) if max_score > 0 else 0.4
        
        # Sub-niche heuristic (just take the top keyword)
        sub_niche = "generic"
        if best_niche != "other.consumer":
             # Find which keyword triggered it
             for kw in self.NICHE_KEYWORDS[best_niche]:
                 if kw in all_text:
                     sub_niche = kw
                     break
        
        return best_niche, sub_niche, confidence, signals
