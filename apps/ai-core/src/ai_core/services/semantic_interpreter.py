from typing import List, Dict, Optional


class SemanticContextInterpreter:
    """Transforms raw retrieved contexts into short, natural-language paragraphs.

    Inputs:
      - query: user question
      - contexts: list of raw context strings
      - schema_fields: optional list of known field names for the tenant

    Output:
      - list of interpreted sentences/paragraphs (same length <= contexts length)
    """

    def __init__(
        self,
        max_fields_per_context: int = 8,
        synonyms_map: Optional[Dict[str, str]] = None,
    ):
        self.max_fields_per_context = max_fields_per_context
        # Maps alias (normalized) -> canonical label
        self.synonyms_map: Dict[str, str] = (synonyms_map or {}).copy()
        self._learned: Dict[str, str] = {}

    def interpret(
        self,
        query: str,
        contexts: List[str],
        schema_fields: Optional[List[str]] = None,
        synonyms_map: Optional[Dict[str, str]] = None,
    ) -> List[str]:
        if not contexts:
            return []
        if isinstance(synonyms_map, dict) and synonyms_map:
            # Update synonyms map for this call
            self.synonyms_map.update({str(k): str(v) for k, v in synonyms_map.items()})
        # reset learned mappings for this run
        self._learned = {}
        ql = (query or "").lower()
        out: List[str] = []
        for c in contexts:
            # Prefer labeled rows split by pipes or newlines: Field: Value | Field2: Value2
            sentences = self._humanize_labeled_row(ql, c, schema_fields)
            if not sentences:
                # Fallback: trim and keep first 2 sentences from raw text
                sentences = [self._first_sentence(c)]
            out.append(" ".join(s for s in sentences if s))
        return out

    def _first_sentence(self, text: str) -> str:
        t = (text or "").strip()
        parts = [p.strip() for p in t.replace("\n", " ").split(".") if p.strip()]
        return parts[0] + ("." if parts else "")

    def _humanize_labeled_row(
        self, ql: str, context: str, schema_fields: Optional[List[str]]
    ) -> List[str]:
        # Parse key: value pairs from "A: x | B: y" or multiline
        kvs: Dict[str, str] = {}
        raw = (context or "").replace("\n", " | ")
        for seg in raw.split("|"):
            if ":" in seg:
                k, v = seg.split(":", 1)
                k = k.strip()
                v = v.strip()
                if k and v:
                    kvs[k] = v
        if not kvs:
            return []
        # Pick relevant fields by schema_fields (if provided), otherwise by query tokens
        keep: Dict[str, str] = {}
        allowed_canon: Optional[set] = None
        if schema_fields:
            allowed_canon = set()
            for f in schema_fields:
                fn = self._normalize_field_name(str(f))
                if fn:
                    allowed_canon.add(fn)
            for k, v in kvs.items():
                kn = self._normalize_field_name(k)
                # Choose best canonical match from allowed set
                best_can = self._best_canonical(kn, allowed_canon)
                if best_can is not None:
                    keep[k] = v
                    # learn alias mapping if alias differs from canonical
                    if kn and best_can and kn != best_can:
                        self._learned[kn] = best_can
        if not keep:
            tokens = set([t for t in ql.split() if len(t) > 2])
            for k, v in kvs.items():
                kn = self._normalize_field_name(k)
                if (any(t in kn for t in tokens)) or (
                    any(t in v.lower() for t in tokens)
                ):
                    keep[k] = v
        # If nothing matched, keep a small subset (up to max_fields_per_context)
        if not keep:
            for k in list(kvs.keys())[: self.max_fields_per_context]:
                keep[k] = kvs[k]
        # Compose combined summaries where logical, then add remaining facts
        sentences: List[str] = []
        name = self._pick_name_field(kvs)
        # Combined role sentence (position + department)
        role_sent = self._compose_role_sentence(name, keep)
        if role_sent:
            sentences.append(role_sent)
        # Manager sentence
        mgr = self._find_first_by_canon(keep, {"manager", "supervisor"})
        if mgr:
            sentences.append(f"{(name or 'This record')}'s manager is {mgr}.")
        # Location sentence (city/state/country)
        loc_sent = self._compose_location_sentence(name, keep)
        if loc_sent:
            sentences.append(loc_sent)
        # Important single facts (hire date, salary, marital status, dob)
        single_keys = ["hire_date", "salary", "marital_status", "dob"]
        for canon in single_keys:
            val = self._find_first_by_canon(keep, {canon})
            if val:
                sentences.append(self._to_sentence(name, canon, val))
        # Remaining fields
        added = set()
        for s in sentences:
            added.add(s)
        for k, v in keep.items():
            sent = self._to_sentence(name, k, v)
            if sent and sent not in added:
                sentences.append(sent)
        return sentences[: self.max_fields_per_context]

    def _pick_name_field(self, kvs: Dict[str, str]) -> Optional[str]:
        for cand in ["employee_name", "name", "full_name", "employee", "person"]:
            for k in kvs.keys():
                if cand in k.lower().replace(" ", "_"):
                    return kvs.get(k)
        return None

    def _to_sentence(self, name: Optional[str], key: str, val: str) -> str:
        subj = name or "This record"
        field_phrase = self._normalize_field_name(key)
        value_phrase = self._render_value(val)
        # Choose a verb based on value type
        if value_phrase in ("yes", "no"):
            verb = "is" if not field_phrase.startswith("has ") else ""
            if verb:
                return f"{subj} {verb} {field_phrase} ({value_phrase})."
            return f"{subj} {field_phrase} ({value_phrase})."
        return f"{subj}'s {field_phrase} is {value_phrase}."

    def _normalize_field_name(self, key: str) -> str:
        import re

        k = (key or "").strip()
        k = k.replace("__", "_")
        # Split camelCase → camel Case
        k = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", k)
        # Replace underscores with spaces
        k = k.replace("_", " ")
        k = k.lower()
        # Drop common suffixes
        for suf in [" desc", " description", " code", " id", " idx", " name"]:
            if k.endswith(suf):
                k = k[: -len(suf)]
        k = " ".join(k.split())
        # Apply synonyms normalization to canonical where available
        if self.synonyms_map and k in self.synonyms_map:
            return self.synonyms_map[k]
        return k

    def _render_value(self, val: str) -> str:
        import re

        v = (val or "").strip()
        if not v:
            return v
        vl = v.lower()
        yn = {"y": "yes", "n": "no", "true": "yes", "false": "no"}
        if vl in yn:
            return yn[vl]
        # Percentages
        if re.fullmatch(r"\d+(?:\.\d+)?%", v):
            return v.replace("%", " percent")
        # Currency (simple)
        if re.fullmatch(r"[$€£]\s?\d[\d,]*(?:\.\d+)?", v):
            return v
        # Dates (very lenient detection)
        if re.search(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}", v):
            return v
        return v

    # Helpers for combined sentences
    def _canonical_label(self, key: str) -> str:
        k = self._normalize_field_name(key)
        mapping = {
            "manager": {"manager", "supervisor", "reporting manager", "boss"},
            "department": {"department", "dept", "division", "team", "unit"},
            "position": {
                "position",
                "title",
                "job title",
                "job",
                "designation",
                "role",
            },
            "city": {"city", "town"},
            "state": {"state", "province", "region"},
            "country": {"country", "nation"},
            "hire_date": {"date of hire", "hire date", "hired on", "start date"},
            "dob": {"date of birth", "dob", "birth date", "birthday"},
            "salary": {"salary", "base salary", "compensation", "pay", "wage"},
            "marital_status": {"marital status", "marital", "maritaldesc"},
        }
        # Apply external synonyms map first
        if self.synonyms_map and k in self.synonyms_map:
            return self.synonyms_map[k]
        for canon, alts in mapping.items():
            if k in alts:
                return canon
        return k

    def _best_canonical(self, alias_norm: str, allowed: set) -> Optional[str]:
        if not allowed:
            return None
        if alias_norm in allowed:
            return alias_norm
        # pick allowed item with largest token overlap or substring relation
        alias_tokens = set(alias_norm.split())
        best = None
        best_score = 0
        for a in allowed:
            if alias_norm in a or a in alias_norm:
                return a
            toks = set(a.split())
            score = len(alias_tokens & toks)
            if score > best_score:
                best_score = score
                best = a
        return best

    def get_learned_mappings(self) -> Dict[str, str]:
        return dict(self._learned)

    def _find_first_by_canon(self, kvs: Dict[str, str], canons: set) -> Optional[str]:
        for k, v in kvs.items():
            if self._canonical_label(k) in canons:
                return v
        return None

    def _compose_role_sentence(
        self, name: Optional[str], kvs: Dict[str, str]
    ) -> Optional[str]:
        position = self._find_first_by_canon(kvs, {"position"})
        dept = self._find_first_by_canon(kvs, {"department"})
        subj = name or "This record"
        if position and dept:
            return f"{subj} works as {position} in the {dept} department."
        if position:
            return f"{subj} works as {position}."
        if dept:
            return f"{subj} works in the {dept} department."
        return None

    def _compose_location_sentence(
        self, name: Optional[str], kvs: Dict[str, str]
    ) -> Optional[str]:
        city = self._find_first_by_canon(kvs, {"city"})
        state = self._find_first_by_canon(kvs, {"state"})
        country = self._find_first_by_canon(kvs, {"country"})
        subj = name or "This record"
        if city and state:
            return f"{subj} is based in {city}, {state}."
        if city and country:
            return f"{subj} is based in {city}, {country}."
        if state and country:
            return f"{subj} is based in {state}, {country}."
        if city:
            return f"{subj} is based in {city}."
        if state:
            return f"{subj} is based in {state}."
        if country:
            return f"{subj} is based in {country}."
        return None
