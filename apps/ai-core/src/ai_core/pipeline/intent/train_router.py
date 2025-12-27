from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Tuple


STOPWORDS = {
    "the",
    "a",
    "an",
    "to",
    "of",
    "and",
    "or",
    "in",
    "on",
    "for",
    "with",
    "is",
    "are",
    "be",
    "by",
    "at",
    "from",
    "this",
    "that",
    "it",
    "as",
    "about",
    "into",
    "how",
    "what",
    "who",
    "which",
}


def normalize(text: str) -> str:
    t = re.sub(r"[^a-zA-Z0-9\s]", " ", text or "")
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def ngrams(tokens: List[str], n: int) -> List[str]:
    return [" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def mine_phrases(queries: List[str], top_k: int = 20) -> List[str]:
    cand = Counter()
    for q in queries:
        qn = normalize(q)
        toks = [t for t in qn.split() if t not in STOPWORDS]
        for n in (1, 2, 3):
            for g in ngrams(toks, n):
                if len(g) <= 2:
                    continue
                cand[g] += 1
    # Keep top_k unique phrases by frequency
    phrases = [p for p, _c in cand.most_common(top_k)]
    return phrases


def load_jsonl(path: Path) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if isinstance(data, dict) and "query" in data and "intent" in data:
                    items.append({"query": str(data["query"]), "intent": str(data["intent"])})
            except Exception:
                continue
    return items


def merge_overrides(
    base: Dict[str, List[str]], new_items: Dict[str, List[str]], max_per_intent: int
) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {k: list(v) for k, v in base.items()}
    for intent, phrases in new_items.items():
        out.setdefault(intent, [])
        seen = set(out[intent])
        for p in phrases:
            if p not in seen:
                out[intent].append(p)
                seen.add(p)
            if len(out[intent]) >= max_per_intent:
                break
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Train/update per-tenant intent catalog overrides")
    ap.add_argument("--tenant-id", required=True, help="Tenant ID to train for")
    ap.add_argument(
        "--input",
        required=True,
        help="Path to labeled dataset (JSONL with fields: query, intent)",
    )
    ap.add_argument(
        "--catalog-dir",
        default="data/intent_catalog",
        help="Directory to write per-tenant catalog JSON",
    )
    ap.add_argument("--top-k", type=int, default=20, help="Top phrases per intent to mine")
    ap.add_argument(
        "--max-per-intent",
        type=int,
        default=64,
        help="Max phrases to retain for each intent after merge",
    )
    args = ap.parse_args()

    tenant_id = args.tenant_id
    data_path = Path(args.input)
    if not data_path.is_file():
        raise SystemExit(f"Input not found: {data_path}")
    items = load_jsonl(data_path)
    if not items:
        raise SystemExit("No labeled items found in dataset")

    # Group queries by intent
    intent_to_queries: Dict[str, List[str]] = defaultdict(list)
    for it in items:
        intent_to_queries[it["intent"]].append(it["query"])

    # Mine phrases per intent
    mined: Dict[str, List[str]] = {}
    for intent, qs in intent_to_queries.items():
        mined[intent] = mine_phrases(qs, top_k=int(args.top_k))

    # Load existing tenant catalog if present
    out_dir = Path(args.catalog_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{tenant_id}.json"
    base: Dict[str, List[str]] = {}
    if out_file.is_file():
        try:
            base = json.loads(out_file.read_text(encoding="utf-8"))
        except Exception:
            base = {}

    merged = merge_overrides(base, mined, max_per_intent=int(args.max_per_intent))
    out_file.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote catalog overrides: {out_file}")


if __name__ == "__main__":
    main()

