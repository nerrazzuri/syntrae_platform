
"""
Normalization Rules - Version 1.1.0
Risk-Layered Rules Engine for Malaysian/English Normalization.
"""
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class NormalizationRule:
    id: str
    type: str  # TOKEN, PHRASE, REGEX
    pattern: str
    replacement: str
    risk: str  # LOW, MED, HIGH
    examples: List[str]
    description: Optional[str] = None

# --- Layer 1: SAFE TOKEN MAP (Low Risk, Context-Free) ---
SAFE_TOKEN_RULES = [
    NormalizationRule("EN_TOK_001", "TOKEN", "u", "you", "LOW", ["u ok?"]),
    NormalizationRule("EN_TOK_002", "TOKEN", "r", "are", "LOW", ["how r u"]),
    NormalizationRule("EN_TOK_003", "TOKEN", "pls", "please", "LOW", ["pls help"]),
    NormalizationRule("EN_TOK_004", "TOKEN", "plz", "please", "LOW", ["plz"]),
    NormalizationRule("EN_TOK_005", "TOKEN", "thx", "thanks", "LOW", ["thx"]),
    NormalizationRule("EN_TOK_006", "TOKEN", "tq", "thank you", "LOW", ["tq"]),
    NormalizationRule("EN_TOK_007", "TOKEN", "dm", "direct message", "LOW", ["dm me"]),
    NormalizationRule("EN_TOK_008", "TOKEN", "pm", "private message", "LOW", ["pm price"]),
    
    NormalizationRule("MS_TOK_001", "TOKEN", "nk", "want", "LOW", ["nk beli"]),
    NormalizationRule("MS_TOK_002", "TOKEN", "nak", "want", "LOW", ["nak order"]),
    NormalizationRule("MS_TOK_003", "TOKEN", "dpt", "get", "LOW", ["dpt murah"]),
    NormalizationRule("MS_TOK_004", "TOKEN", "dapat", "get", "LOW", ["dapat offer"]),
    NormalizationRule("MS_TOK_005", "TOKEN", "brp", "how much", "LOW", ["brp ni"]),
    NormalizationRule("MS_TOK_006", "TOKEN", "berapa", "how much", "LOW", ["berapa harga"]),
    NormalizationRule("MS_TOK_007", "TOKEN", "blh", "can", "LOW", ["blh pm?"]),
    NormalizationRule("MS_TOK_008", "TOKEN", "boleh", "can", "LOW", ["boleh"]),
    NormalizationRule("MS_TOK_009", "TOKEN", "sy", "i", "LOW", ["sy nak"]),
    NormalizationRule("MS_TOK_010", "TOKEN", "saya", "i", "LOW", ["saya nak"]),
    NormalizationRule("MS_TOK_011", "TOKEN", "janji", "promise", "LOW", ["janji ok"]),
    NormalizationRule("MS_TOK_012", "TOKEN", "utk", "for", "LOW", ["utk u"]),
    NormalizationRule("MS_TOK_013", "TOKEN", "untuk", "for", "LOW", ["untuk u"]),
    NormalizationRule("MS_TOK_014", "TOKEN", "yg", "that", "LOW", ["yg tu"]),
    NormalizationRule("MS_TOK_015", "TOKEN", "yang", "that", "LOW", ["yang ni"]),
    NormalizationRule("MS_TOK_016", "TOKEN", "tau", "know", "LOW", ["tak tau"]),
]

# --- Layer 2: EXACT PHRASE RULES (High Precision, Medium Risk) ---
PHRASE_RULES = [
    NormalizationRule("PHRASE_001", "PHRASE", "ok ke?", "is it ok?", "MED", ["ok ke?"]),
    NormalizationRule("PHRASE_002", "PHRASE", "ok ke", "is it ok", "MED", ["this ok ke"]),
    NormalizationRule("PHRASE_003", "PHRASE", "beli ke", "can buy", "MED", ["where beli ke"]), # Context dependent? 'X beli ke Y' -> 'X buy or Y'. But commonly 'boleh beli ke' -> 'can buy?'. Risk MED.
    NormalizationRule("PHRASE_004", "PHRASE", "berapa harga", "how much is the price", "MED", ["berapa harga boss"]),
    NormalizationRule("PHRASE_005", "PHRASE", "how much price", "how much is the price", "MED", ["how much price"]),
    NormalizationRule("PHRASE_006", "PHRASE", "pm price", "private message price", "MED", ["pm price"]),
]

# --- Layer 3: REGEX RULES (Noise Cleanup) ---
REGEX_RULES = [
    NormalizationRule("REG_001", "REGEX", r"(.)\1{2,}", r"\1", "LOW", ["sooo -> so"]), # Repeated chars > 2 reduced to 1? Or 2? 'good' -> 'god'? No. repeated 3+ times to 1. BE CAREFUL. 'sooo' -> 'so'. 'grrr' -> 'gr'. 
]

# --- Ambiguity & Particles ---
AMBIGUOUS_TOKENS = {
    "x": "not", # Requires standalone check
    "ke": None, # Question marker? or 'to'? Context heavy.
}

PARTICLES = {"lah", "lor", "leh", "meh", "kan", "je", "jer", "ah", "ni", "tu"} # 'ni'/'tu' are demonstratives (this/that) but often used as particles or ignored in English intent if checking just keywords. BUT 'nak ni' -> 'want this' is important. moving 'ni'/'tu' out of particles if semantic.

# Refined Particles (Pure Style/Emphasis)
STYLE_PARTICLES = {"lah", "lor", "leh", "meh", "ah", "jer", "je"} 

# Semantic Demonstratives (Keep or map)
# 'ni' -> 'this', 'tu' -> 'that' are in Layer 1 if safe, or handled specifically.
# Let's add them to SAFE_TOKEN if we want them normalized.
SAFE_TOKEN_RULES.extend([
    NormalizationRule("MS_DEM_001", "TOKEN", "ni", "this", "LOW", ["yg ni"]),
    NormalizationRule("MS_DEM_002", "TOKEN", "tu", "that", "LOW", ["yg tu"]),
])

# Language Markers (Heuristics)
MS_MARKERS = {"tak", "nak", "ke", "je", "dah", "x", "yg", "utk", "kau", "aku", "ni", "tu", "lah"}
EN_MARKERS = {"the", "is", "are", "you", "i", "to", "for", "and", "but", "so", "it", "this"}
