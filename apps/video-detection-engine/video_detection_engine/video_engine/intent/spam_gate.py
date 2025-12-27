import re
from typing import Tuple, List

class SpamGate:
    """
    Filters out obvious spam, ads, and irrelevant content.
    """
    
    SPAM_PATTERNS = [
        r"https?://\S+",           # Links
        r"www\.\S+",               # Links
        r"\.com\b",                # Lazy link
        r"\bcrypto\b",             # Crypto
        r"\bbitcoin\b",            # Crypto
        r"\bforex\b",              # Forex
        r"\binvestment\b",         # Generic financial spam
        r"\bfollow me\b",          # Self promo
        r"\bcheck out my\b",       # Self promo
        r"\bclick link\b",         # Call to action spam
        r"\bfree money\b",         # Scam
        r"\bwhatsapp\b",           # Contact spam
        r"\. ?c ?o ?m",            # Obfuscated links
        r"\d{10,}"                 # Phone numbers/long codes
    ]
    
    def __init__(self):
        self.regexes = [re.compile(p, re.IGNORECASE) for p in self.SPAM_PATTERNS]

    def is_spam(self, text: str) -> Tuple[bool, List[str]]:
        """
        Returns (is_spam, reasons)
        """
        reasons = []
        for r in self.regexes:
            if r.search(text):
                reasons.append(f"spam_regex:{r.pattern}")
        
        # Emoji overload check (simple heuristic: if > 50% of chars are non-ascii/symbols -> potential spam/low quality)
        # For now, stick to Spec 3 ("Spam Gate") which lists Ads, Crypto, Links.
        
        return len(reasons) > 0, reasons
