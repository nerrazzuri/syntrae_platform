"""
Module for aggregating confidence scores.
"""

class ConfidenceScorer:
    """
    Aggregates signals to produce a final confidence score.
    """
    
    def aggregate(self, 
                  commercial_conf: float, 
                  niche_conf: float, 
                  content_conf: float) -> float:
        """
        Calculates final combined confidence.
        
        Logic:
        - If commercial confidence is high, we trust the niche/content classifiers more.
        - If classification is weak, drag down the total score.
        """
        
        # Weighted average
        # Commercialness is the most important gate.
        # Niche/Content are secondary.
        
        final = (commercial_conf * 0.5) + (niche_conf * 0.25) + (content_conf * 0.25)
        
        return round(final, 4)
