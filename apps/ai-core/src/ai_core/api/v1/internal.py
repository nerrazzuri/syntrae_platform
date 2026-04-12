"""
Internal knowledge API with JWT-based RBAC.
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Request, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from shared.database.session import get_db
from ai_core.services.internal_knowledge_service import InternalKnowledgeService
from ai_core.services.internal_knowledge_service import InternalKnowledgeService
from ai_core.services.draft_service import DraftGenerationService
from ai_core.services.document_service import DocumentService
from ai_core.services.normalization_service import NormalizationService
from ai_core.pipeline.retriever.dense_retriever import DenseRetriever
from ai_core.pipeline.llm.llm_client import LLMClient
from shared.security.jwt import JWTService
from shared.database.models import Document, KnowledgeBase
import os
import logging
import json
import re

router = APIRouter(prefix="/v1/internal", tags=["internal-knowledge"])
jwt_service = JWTService()
normalization_service = NormalizationService()
dense_retriever = DenseRetriever()


def parse_bearer(auth: Optional[str]) -> str:
    if not auth:
        raise HTTPException(status_code=401, detail="Authorization required")
    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return parts[1]


def extract_internal_secret(request: Request) -> Optional[str]:
    headers = {k.lower(): v for k, v in request.headers.items()}
    return (
        headers.get("x-internal-secret")
        or headers.get("x_internal_secret")
    )


def require_internal_catalog_access(request: Request, account_id: str) -> None:
    secret_header = extract_internal_secret(request)
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    if not env_secret or secret_header != env_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    account_header = request.headers.get("X-Account-Id")
    if not account_header:
        raise HTTPException(status_code=400, detail="Missing X-Account-Id header")
    if account_header != account_id:
        raise HTTPException(status_code=403, detail="Account ID mismatch between header and payload")


def _normalize_cell(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _pick_first(row: Dict[str, Any], *keys: str) -> Optional[str]:
    normalized = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        if key in normalized:
            value = _normalize_cell(normalized[key])
            if value:
                return value
    return None


def _split_multi_value(value: Optional[str]) -> List[str]:
    if not value:
        return []
    items = []
    for piece in re.split(r"[\n,;|]+", value):
        clean = piece.strip()
        if clean:
            items.append(clean)
    return items[:20]


def _normalize_string_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        items: List[str] = []
        for item in value:
            clean = _normalize_cell(item)
            if clean:
                items.append(clean)
        return items[:20]
    return _split_multi_value(_normalize_cell(value))


def _is_image_filename(value: Optional[str]) -> bool:
    return bool(value and re.search(r"\.(png|jpe?g|bmp|tiff?|webp)$", value.strip(), re.IGNORECASE))


def _has_cjk(value: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", value or ""))


def _extract_non_english_aliases(text: str, max_items: int = 16) -> List[str]:
    aliases: List[str] = []
    seen: set[str] = set()
    normalized = _normalize_extracted_text(text)
    if not _has_cjk(normalized):
        return []

    for line in normalized.splitlines():
        clean = line.strip(" -*•\t")
        if not clean or not _has_cjk(clean):
            continue

        pieces = re.split(r"[，,。；;：:\|\(\)（）/]+", clean)
        for piece in pieces:
            phrase = piece.strip(" -*•\t")
            if not phrase or not _has_cjk(phrase):
                continue
            if len(phrase) < 2 or len(phrase) > 24:
                continue
            key = phrase.lower()
            if key in seen:
                continue
            seen.add(key)
            aliases.append(phrase)
            if len(aliases) >= max_items:
                return aliases
    return aliases


def _looks_like_ocr_noise(value: Optional[str]) -> bool:
    text = (value or "").strip()
    if not text:
        return True

    if _has_cjk(text):
        return False

    tokens = re.findall(r"[A-Za-z]{3,}", text)
    if not tokens:
        return len(text) < 12

    uppercase_tokens = [token for token in tokens if token.isupper() and len(token) >= 4]
    vowel_poor_tokens = [
        token for token in tokens
        if len(token) >= 6 and (sum(1 for ch in token.lower() if ch in "aeiou") / max(len(token), 1)) < 0.18
    ]
    known_words = re.findall(
        r"\b(product|service|treatment|skin|tea|serum|cream|benefit|suitable|repair|hydrating|sensitive|price|package|care)\b",
        text,
        re.IGNORECASE,
    )

    if known_words:
        return False

    return len(tokens) >= 2 and (len(uppercase_tokens) + len(vowel_poor_tokens)) / len(tokens) >= 0.55


def _candidate_is_meaningful(candidate: Dict[str, Any], filename: str, title: str) -> bool:
    name = _normalize_cell(candidate.get("name")) or ""
    description = _normalize_cell(candidate.get("description")) or ""
    combined = " ".join([
        name,
        description,
        _normalize_cell(candidate.get("category")) or "",
        _normalize_cell(candidate.get("target_buyer")) or "",
        " ".join(candidate.get("key_benefits") or [] if isinstance(candidate.get("key_benefits"), list) else []),
    ]).strip()

    if len(description) < 12:
        return False
    if _is_image_filename(name) and name.strip().lower() in {filename.strip().lower(), title.strip().lower()}:
        return False
    return not _looks_like_ocr_noise(combined)


def _normalize_extracted_text(text: str | None) -> str:
    normalized = (text or "").strip()
    if not normalized:
        return ""

    literal_newlines = normalized.count("\\n")
    actual_newlines = normalized.count("\n")
    if literal_newlines > 5 and actual_newlines <= max(1, literal_newlines // 20):
        normalized = normalized.replace("\\r\\n", "\n").replace("\\n", "\n")
    return normalized


def infer_catalog_candidates(filename: str, data: bytes, svc: DocumentService) -> List[Dict[str, Any]]:
    name = (filename or "").lower()
    if not (name.endswith(".csv") or name.endswith(".xlsx")):
        return []

    candidates: List[Dict[str, Any]] = []
    seen: set[str] = set()
    dataframes = svc.load_file_to_dataframes(filename, data)
    for sheet_name, df in dataframes.items():
        try:
            normalized_df = svc.normalize_headers(df).fillna("")
        except Exception:
            normalized_df = df.fillna("")

        for _, series in normalized_df.head(100).iterrows():
            row = {str(k).strip().lower(): v for k, v in series.to_dict().items()}
            item_name = _pick_first(row, "name", "product", "product_name", "title", "offer", "item")
            description = _pick_first(
                row,
                "description",
                "details",
                "product_description",
                "short description",
                "full description",
                "summary",
                "intro",
            )
            if not item_name:
                continue

            key = f"{sheet_name}:{item_name.lower()}"
            if key in seen:
                continue
            seen.add(key)

            if not description:
                benefits_text = _pick_first(row, "benefits", "key_benefits", "key features", "features", "highlights")
                description = benefits_text or f"Imported from {sheet_name}"
            else:
                full_description = _pick_first(row, "full description")
                if full_description and full_description != description:
                    description = f"{description}; {full_description}"

            candidate = {
                "name": item_name,
                "category": _pick_first(row, "category", "type", "product_type"),
                "description": description,
                "price_label": _pick_first(row, "price", "price_label", "price (myr)", "amount", "price_range"),
                "target_buyer": _pick_first(row, "target_buyer", "target audience", "audience", "suitable_for", "for_who"),
                "key_benefits": _split_multi_value(_pick_first(row, "benefits", "key_benefits", "key features", "features", "highlights")),
                "common_objections": _split_multi_value(_pick_first(row, "common_objections", "objections", "concerns", "faq")),
                "cta_url": _pick_first(row, "cta_url", "url", "product_url", "link"),
                "cta_label": _pick_first(row, "cta_label", "cta", "button_text"),
                "availability_status": _pick_first(row, "availability_status", "availability", "stock_status", "status") or "AVAILABLE",
                "forbidden_claims": _split_multi_value(_pick_first(row, "forbidden_claims", "restrictions", "prohibited_claims")),
                "priority": None,
                "metadata": {
                    "sheet": sheet_name,
                    "import_source": "tabular",
                    "import_filename": filename,
                    "sku": _pick_first(row, "sku", "sku id", "sku_id"),
                    "hook": _pick_first(row, "hook"),
                    "use_case": _pick_first(row, "use case", "occasion", "scenario"),
                    "aliases": _normalize_string_list(_pick_first(row, "aliases", "alias", "keywords", "search_terms")),
                    "symptoms": _normalize_string_list(_pick_first(row, "symptoms", "needs", "pain_points")),
                },
            }

            priority_text = _pick_first(row, "priority", "rank", "score")
            if priority_text:
                try:
                    candidate["priority"] = max(0, min(100, int(float(priority_text))))
                except Exception:
                    candidate["priority"] = None

            candidates.append(candidate)

    return candidates[:50]


def _derive_category(text: str, filename: str = "") -> Optional[str]:
    haystack = f"{filename}\n{text}".lower()
    keyword_map = [
        ("tea", "Tea"),
        ("serum", "Serum"),
        ("supplement", "Supplement"),
        ("skincare", "Skincare"),
        ("cream", "Cream"),
        ("capsule", "Supplement"),
        ("drink", "Drink"),
        ("herbal", "Herbal Wellness"),
        ("草本", "Herbal Wellness"),
        ("茶", "Tea"),
        ("膏", "Topical Care"),
        ("汤", "Wellness Drink"),
        ("面膜", "Skincare"),
    ]
    for needle, label in keyword_map:
        if needle in haystack:
            return label
    return None


def _extract_name_from_text(text: str, title: str, filename: str) -> str:
    non_empty_lines = [line.strip(" -*•\t") for line in text.splitlines() if line.strip()]
    candidates = []
    if title:
        candidates.append(title.strip())
    candidates.extend(non_empty_lines[:8])

    for line in candidates:
        if len(line) < 2:
            continue
        if any(marker in line for marker in ("适合人群", "不适宜人群", "成份", "ingredients", "suitable", "warning")):
            continue
        if len(line) <= 48:
            return line
    return title or os.path.splitext(filename)[0] or "Imported Product"


def _extract_section_lines(text: str, markers: List[str], stop_markers: List[str] | None = None) -> List[str]:
    lines = [line.strip(" -*•\t") for line in text.splitlines()]
    stop_markers = stop_markers or []
    hits: List[str] = []
    collecting = False
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            if collecting and hits:
                break
            continue
        if any(marker.lower() in line.lower() for marker in markers):
            collecting = True
            continue
        if collecting and any(marker.lower() in line.lower() for marker in stop_markers):
            break
        if collecting:
            hits.append(line)
            if len(hits) >= 6:
                break
    return hits


def _split_sku_blocks(text: str) -> List[Dict[str, str]]:
    lines = [line.strip() for line in _normalize_extracted_text(text).splitlines()]
    blocks: List[Dict[str, str]] = []
    current_header: str | None = None
    current_lines: List[str] = []
    sku_re = re.compile(r"^SKU\s+\S+\s*(?::|\-|–|—)\s*\S+.*$", re.IGNORECASE)

    for line in lines:
        match = sku_re.match(line)
        if match:
            if current_header:
                blocks.append({"header": current_header, "body": "\n".join(current_lines).strip()})
            current_header = line
            current_lines = []
            continue
        if current_header:
            current_lines.append(line)

    if current_header:
        blocks.append({"header": current_header, "body": "\n".join(current_lines).strip()})
    return blocks


def _collect_section(block_text: str, start: str, stops: List[str]) -> List[str]:
    lines = [line.strip(" -*\t") for line in block_text.splitlines()]
    hits: List[str] = []
    collecting = False
    for line in lines:
        if not line:
            continue
        lower = line.lower()
        if lower.startswith(start.lower()):
            collecting = True
            inline = line.split(":", 1)[1].strip() if ":" in line else ""
            if inline:
                hits.append(inline)
            continue
        if collecting and any(lower.startswith(stop.lower()) for stop in stops):
            break
        if collecting:
            if line.startswith("[[PAGE:"):
                continue
            hits.append(line)
    return hits[:12]


def _extract_field(block_text: str, *labels: str) -> Optional[str]:
    for label in labels:
        pattern = re.compile(rf"^{re.escape(label)}\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
        match = pattern.search(block_text or "")
        if match:
            value = _normalize_cell(match.group(1))
            if value:
                return value
    return None


def _collect_leading_bullets(block_text: str, after_labels: List[str], stops: List[str]) -> List[str]:
    lines = [line.strip() for line in block_text.splitlines()]
    hits: List[str] = []
    collecting = False
    for line in lines:
        if not line or line.startswith("[[PAGE:"):
            continue
        lower = line.lower()
        if any(lower.startswith(f"{label.lower()}:") for label in after_labels):
            collecting = True
            continue
        if collecting and any(lower.startswith(stop.lower()) for stop in stops):
            break
        if collecting and line.startswith(("-", "*", "•")):
            hits.append(line.strip(" -*•\t"))
    return hits[:12]


def _candidates_from_sku_blocks(filename: str, blocks: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    seen: set[str] = set()
    sku_re = re.compile(r"^SKU\s+([^\s:\-–—]+)\s*(?::|\-|–|—)\s*(.+)$", re.IGNORECASE)

    for index, block in enumerate(blocks[:50], start=1):
        header = block.get("header") or ""
        body = block.get("body") or ""
        match = sku_re.match(header)
        if not match:
            continue
        sku = _normalize_cell(match.group(1))
        product = _normalize_cell(match.group(2))
        if not product:
            continue

        compatible = _extract_field(body, "Compatible Device", "Compatible Devices")
        if compatible:
            compatible = compatible.rstrip(" :")
        features = _collect_section(body, "Features", ["Details", "Selling Points", "SKU"])
        if not features:
            features = _collect_leading_bullets(
                body,
                after_labels=["Compatible Device", "Compatible Devices"],
                stops=["Details", "Selling Points", "SKU"],
            )
        selling_points = _collect_section(body, "Selling Points", ["SKU"])
        material = _extract_field(body, "Material")
        function = _extract_field(body, "Function")
        target_users = _extract_field(body, "Target Users")
        category = product

        name_parts = []
        if compatible:
            name_parts.append(compatible.replace("(latest models)", "").strip())
        name_parts.append(product)
        if sku and not re.search(r"^<[^>]+>$", sku):
            name_parts.append(f"({sku})")
        name = " ".join(part for part in name_parts if part).strip()

        description_parts = []
        if features:
            description_parts.append(" ".join(features[:3]))
        details = [item for item in [material, function] if item]
        if details:
            description_parts.append("; ".join(details))
        description = " ".join(description_parts).strip() or f"Imported SKU for {product}"

        sku_is_placeholder = bool(sku and re.search(r"^<[^>]+>$", sku))
        key = (sku if sku and not sku_is_placeholder else f"{index}:{name}").lower()
        if key in seen:
            continue
        seen.add(key)

        candidate = {
            "name": name,
            "category": category,
            "description": description[:600],
            "price_label": None,
            "target_buyer": target_users,
            "key_benefits": selling_points or features[:6],
            "common_objections": [],
            "cta_url": None,
            "cta_label": None,
            "availability_status": "AVAILABLE",
            "forbidden_claims": [],
            "priority": 50,
            "metadata": {
                "sku": sku,
                "product": product,
                "compatible_device": compatible,
                "import_source": "text_sku_block",
                "import_filename": filename,
            },
        }
        if candidate["name"] and candidate["description"] and _candidate_is_meaningful(candidate, filename, filename):
            candidates.append(candidate)
    return candidates[:50]


def _chunk_catalog_text(text: str, max_chars: int = 7000, overlap: int = 600) -> List[str]:
    clean = _normalize_extracted_text(text)
    if not clean:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(clean) and len(chunks) < 8:
        end = min(len(clean), start + max_chars)
        if end < len(clean):
            marker = clean.rfind("\nSKU ", start, end)
            if marker > start + max_chars // 2:
                end = marker
        chunks.append(clean[start:end].strip())
        if end >= len(clean):
            break
        start = max(0, end - overlap)
    return [chunk for chunk in chunks if chunk]


def _normalize_llm_candidates(candidates: Any, filename: str, source: str) -> List[Dict[str, Any]]:
    if not isinstance(candidates, list):
        return []
    normalized = []
    for candidate in candidates[:12]:
        if not isinstance(candidate, dict):
            continue
        normalized.append({
            "name": _normalize_cell(candidate.get("name")),
            "category": _normalize_cell(candidate.get("category")),
            "description": _normalize_cell(candidate.get("description")),
            "price_label": _normalize_cell(candidate.get("price_label")),
            "target_buyer": _normalize_cell(candidate.get("target_buyer")),
            "key_benefits": _split_multi_value(",".join(candidate.get("key_benefits", []) if isinstance(candidate.get("key_benefits"), list) else [])),
            "common_objections": _split_multi_value(",".join(candidate.get("common_objections", []) if isinstance(candidate.get("common_objections"), list) else [])),
            "cta_url": _normalize_cell(candidate.get("cta_url")),
            "cta_label": _normalize_cell(candidate.get("cta_label")),
            "availability_status": _normalize_cell(candidate.get("availability_status")) or "AVAILABLE",
            "forbidden_claims": _split_multi_value(",".join(candidate.get("forbidden_claims", []) if isinstance(candidate.get("forbidden_claims"), list) else [])),
            "priority": candidate.get("priority"),
            "metadata": {
                "import_source": source,
                "import_filename": filename,
                "aliases": _normalize_string_list(candidate.get("aliases")),
                "use_cases": _normalize_string_list(candidate.get("use_cases")),
                "symptoms": _normalize_string_list(candidate.get("symptoms")),
            },
        })
    return [
        item for item in normalized
        if item.get("name") and item.get("description") and _candidate_is_meaningful(item, filename, filename)
    ]


def infer_catalog_candidates_from_text(
    filename: str,
    title: str,
    extracted_text: str,
) -> List[Dict[str, Any]]:
    text_block = _normalize_extracted_text(extracted_text)
    if not text_block:
        return []

    sku_candidates = _candidates_from_sku_blocks(filename, _split_sku_blocks(text_block))
    if sku_candidates:
        return sku_candidates

    llm_client = LLMClient()

    try:
        if llm_client.client:
            aggregated: List[Dict[str, Any]] = []
            seen: set[str] = set()
            for index, sample in enumerate(_chunk_catalog_text(text_block)):
                if len(aggregated) >= 50:
                    break
                prompt = f"""
	You extract structured product catalog items from OCR or document text.
	Return strict JSON only in this shape:
	{{
  "candidates": [
    {{
      "name": "string",
      "category": "string or null",
      "description": "string",
      "price_label": "string or null",
      "target_buyer": "string or null",
      "key_benefits": ["string"],
      "common_objections": ["string"],
      "cta_url": "string or null",
      "cta_label": "string or null",
      "availability_status": "AVAILABLE",
      "forbidden_claims": ["string"],
      "priority": 50,
      "aliases": ["original-language search phrases visible in the source, especially non-English terms"],
      "use_cases": ["short user needs or scenarios visible or directly implied by the source"],
      "symptoms": ["short symptom or problem phrases only when the source explicitly supports them"]
    }}
  ]
	}}

	Rules:
	- Return every distinct product/SKU visible in this source text chunk, up to 12 candidates for this chunk.
	- If the document contains SKU-style records, treat each SKU record as its own candidate.
	- Use factual product wording from the text.
	- Preserve important non-English source phrases as aliases instead of translating them away.
	- For aliases, include original-language benefits, use cases, model names, symptoms, and search keywords that users may type.
	- Do not invent medical symptoms or treatment claims. Only add symptoms if the source explicitly supports the meaning.
	- Put safety/contraindication or unsuitable-user statements into forbidden_claims.
	- Do not invent pricing or URLs.
	- description must be concise and commercially usable.

	Filename: {filename}
	Suggested title: {title}
	Chunk: {index + 1}
	Source text:
	{sample}
	"""
                completion = llm_client.client.chat.completions.create(
                    model=llm_client.model,
                    temperature=0.1,
                    response_format={"type": "json_object"},
                    messages=[{"role": "user", "content": prompt}],
                )
                raw_content = (completion.choices[0].message.content or "").strip()
                parsed = json.loads(raw_content)
                for candidate in _normalize_llm_candidates(parsed.get("candidates"), filename, "ocr_llm"):
                    key = str(candidate.get("name") or "").strip().lower()
                    if key and key not in seen:
                        seen.add(key)
                        aggregated.append(candidate)
            if aggregated:
                return aggregated[:50]
    except Exception:
        pass

    # Heuristic fallback for OCR / PDF text
    name = _extract_name_from_text(text_block, title, filename)
    benefit_lines = _extract_section_lines(
        text_block,
        markers=["benefits", "features", "highlights", "功效", "作用", "主打", "适合人群"],
        stop_markers=["warning", "contraindication", "不适宜人群", "ingredients", "成份"],
    )
    unsuitable_lines = _extract_section_lines(
        text_block,
        markers=["not suitable", "warning", "contraindication", "不适宜人群", "禁忌", "孕妇禁用"],
        stop_markers=["ingredients", "成份"],
    )
    ingredient_lines = _extract_section_lines(
        text_block,
        markers=["ingredients", "ingredient", "成份", "成分"],
        stop_markers=["适合人群", "不适宜人群", "warning"],
    )

    first_paragraphs = [line.strip() for line in text_block.splitlines() if line.strip()]
    description_parts = []
    if benefit_lines:
        description_parts.append(" ".join(benefit_lines[:2]))
    if ingredient_lines:
        description_parts.append(f"Key ingredients: {'; '.join(ingredient_lines[:3])}")
    if not description_parts:
        description_parts.append(" ".join(first_paragraphs[:3])[:280])

    target_buyer = None
    audience_lines = _extract_section_lines(
        text_block,
        markers=["target buyer", "suitable for", "适合人群"],
        stop_markers=["not suitable", "warning", "contraindication", "不适宜人群"],
    )
    if audience_lines:
        target_buyer = "; ".join(audience_lines[:3])

    candidate = {
        "name": name,
        "category": _derive_category(text_block, filename),
        "description": " ".join(part for part in description_parts if part).strip()[:600],
        "price_label": None,
        "target_buyer": target_buyer,
        "key_benefits": benefit_lines[:8],
        "common_objections": [],
        "cta_url": None,
        "cta_label": None,
        "availability_status": "AVAILABLE",
        "forbidden_claims": unsuitable_lines[:8],
        "priority": 60,
        "metadata": {
            "import_source": "ocr_heuristic",
            "import_filename": filename,
            "aliases": _extract_non_english_aliases(text_block),
        },
    }

    if candidate["name"] and candidate["description"] and _candidate_is_meaningful(candidate, filename, title):
        return [candidate]
    return []


@router.get("/knowledge/list")
def list_knowledge(
    authorization: Optional[str] = Header(None), db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    token = parse_bearer(authorization)
    payload = jwt_service.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = payload.get("role", "END_USER")
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id missing in token")
    svc = InternalKnowledgeService(db)
    return svc.list_documents(tenant_id=tenant_id, role=role)


@router.post("/knowledge/update")
def update_knowledge(
    body: Dict[str, Any],
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    token = parse_bearer(authorization)
    payload = jwt_service.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = payload.get("role", "END_USER")
    doc_id = body.get("id")
    updates = body.get("updates", {})
    if not doc_id:
        raise HTTPException(status_code=400, detail="Missing id")
    svc = InternalKnowledgeService(db)
    try:
        return svc.update_document(role=role, document_id=doc_id, updates=updates)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class SignalInferenceRequest(BaseModel):
    text: str
    existing_signals: Optional[List[Any]] = []
    language: Optional[str] = "en"
    domain: Optional[str] = "unknown"
    intent_category: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


@router.post("/signal-inference")
async def inference_signal(
    payload: SignalInferenceRequest,
    request: Request,
):
    # 1. Enforce Internal Service Authentication
    # Requirement: X-Internal-Secret header must equal AI_CORE_INTERNAL_SECRET env var
    secret_header = extract_internal_secret(request)
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")

    if not env_secret:
        # Configuration error - fail safe
        logger = logging.getLogger("ai_core.api.internal")
        logger.error("AI_CORE_INTERNAL_SECRET not configured")
        raise HTTPException(status_code=500, detail="Internal configuration error")

    if not secret_header or secret_header != env_secret:
        raise HTTPException(
            status_code=401, detail="Invalid or missing internal secret"
        )

    # 2. Enforce Tenant / Workspace Context
    # Requirement: X-Tenant-Id header is mandatory and trusted
    tenant_id = request.headers.get("X-Tenant-Id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-Id header")

    # 3. Invoke Capability with Tenant Context
    cap = request.app.state.capabilities.get("signal_inference")
    if not cap:
        raise HTTPException(
            status_code=500, detail="Signal Inference capability not initialized"
        )

    from ai_core.contracts.capability_request import CapabilityRequest

    # Use request context for auditing
    trace_id = request.headers.get("X-Correlation-ID")
    user_id = request.headers.get("X-User-Id", "system")

    cap_req = CapabilityRequest(
        tenant_id=tenant_id,  # Trusted caller context (Canonical Name)
        user_id=user_id,
        roles=["internal"],
        channel="internal",
        input={
            "text": payload.text,
            "existing_signals": payload.existing_signals,
            "language": payload.language,
            "domain": payload.domain,
            "intent_category": payload.intent_category,
            "context": payload.context,
        },
        context={
            "plan": "enterprise",
            "allow_tools": False
            # Note: Future caching/memory MUST be namespaced by tenant_id
        },
        constraints={},
        trace_id=trace_id,
    )

    result = await cap.execute(cap_req)

    if result.kind == "error":
        raise HTTPException(
            status_code=500, detail=result.payload.get("error", "Unknown error")
        )

    return result.payload


class GenerateDraftRequest(BaseModel):
    lead_id: str
    account_id: str
    force: bool = False
    owner_settings: Optional[Dict[str, Any]] = None
    comment_text: Optional[str] = None
    brand_name: Optional[str] = None
    brand_domain: Optional[str] = None
    platform: Optional[str] = None
    buyer_stage: Optional[str] = None
    intent: Optional[str] = None
    product_context: Optional[Dict[str, Any]] = None
    knowledge_context: Optional[List[Dict[str, Any]]] = None


@router.post("/catalog/import")
async def import_catalog_document(
    request: Request,
    account_id: str = Form(...),
    brand_id: str = Form(...),
    title: str = Form(...),
    source_type: str = Form("FILE"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require_internal_catalog_access(request, account_id)

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")

    svc = DocumentService(db)
    filename = file.filename or "catalog-upload"
    mime_type = file.content_type or "application/octet-stream"
    doc_meta = {
        "catalog_scope": "product_catalog",
        "brand_id": brand_id,
        "workspace_id": account_id,
        "source_type": source_type,
        "original_filename": filename,
        "mime_type": mime_type,
    }

    try:
        if filename.lower().endswith(".csv") or filename.lower().endswith(".xlsx"):
            document_id, chunk_count = svc.process_pandas_and_store(
                account_id,
                title,
                filename,
                data,
                "00000000-0000-0000-0000-000000000000",
                doc_meta=doc_meta,
            )
            preview_text = svc.extract_text_from_file(filename, data)[:500]
            candidates = infer_catalog_candidates(filename, data, svc)
        else:
            extracted = svc.extract_text_from_file(filename, data)
            if not extracted or not extracted.strip():
                raise HTTPException(status_code=400, detail="No text content could be extracted from the file")
            document_id, chunk_count = svc.process_and_store(
                account_id,
                title,
                extracted,
                "00000000-0000-0000-0000-000000000000",
                doc_meta=doc_meta,
            )
            preview_text = extracted[:500]
            sku_blocks = _split_sku_blocks(extracted)
            candidates = _candidates_from_sku_blocks(filename, sku_blocks) if sku_blocks else []
            if not candidates:
                candidates = infer_catalog_candidates_from_text(filename, title, extracted)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Catalog import failed: {exc}")

    return {
        "documentId": document_id,
        "chunkCount": chunk_count,
        "status": "INDEXED",
        "previewText": preview_text,
        "candidates": candidates,
    }


class CatalogSearchRequest(BaseModel):
    account_id: str
    brand_id: str
    query: str
    limit: int = 4


class CatalogRerankCandidate(BaseModel):
    id: str
    name: str
    category: Optional[str] = None
    description: str
    target_buyer: Optional[str] = None
    price_label: Optional[str] = None
    key_benefits: Optional[List[str]] = []
    common_objections: Optional[List[str]] = []
    metadata: Optional[Dict[str, Any]] = {}


class CatalogRerankRequest(BaseModel):
    account_id: str
    query: str
    limit: int = 3
    candidates: List[CatalogRerankCandidate]


@router.post("/catalog/search")
def search_catalog_knowledge(
    payload: CatalogSearchRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    require_internal_catalog_access(request, payload.account_id)
    query = (payload.query or "").strip()
    if not query:
        return {"items": []}

    document_ids = [
        str(row.id)
        for row in (
            db.query(Document.id)
            .join(KnowledgeBase, Document.knowledge_base_id == KnowledgeBase.id)
            .filter(KnowledgeBase.tenant_id == payload.account_id)
            .filter(Document.meta.op("->>")("catalog_scope") == "product_catalog")
            .filter(Document.meta.op("->>")("brand_id") == payload.brand_id)
            .all()
        )
    ]

    if not document_ids:
        return {"items": []}

    results = dense_retriever.search_rich(
        query=query,
        tenant_id=payload.account_id,
        top_k=max(1, min(int(payload.limit or 4), 6)),
        threshold=0.3,
        role="ADMIN",
        allowed_document_ids=document_ids,
    )

    items = [
        {
            "content": item.get("content"),
            "document_id": item.get("document_id"),
            "document_title": item.get("document_title"),
            "score": item.get("score"),
            "meta": item.get("meta") or {},
        }
        for item in results
        if item.get("content")
    ]
    return {"items": items}


@router.post("/catalog/rerank")
def rerank_catalog_items(
    payload: CatalogRerankRequest,
    request: Request,
):
    require_internal_catalog_access(request, payload.account_id)
    query = (payload.query or "").strip()
    candidates = payload.candidates or []
    limit = max(1, min(int(payload.limit or 3), 3))

    if not query or not candidates:
        return {"ranked_ids": [], "mode": "empty"}

    llm_client = LLMClient()
    if not llm_client.client:
        return {"ranked_ids": [], "mode": "unavailable"}

    serialized_candidates = []
    for candidate in candidates[:80]:
        serialized_candidates.append({
            "id": candidate.id,
            "name": candidate.name,
            "category": candidate.category,
            "description": candidate.description,
            "target_buyer": candidate.target_buyer,
            "price_label": candidate.price_label,
            "key_benefits": (candidate.key_benefits or [])[:6],
            "common_objections": (candidate.common_objections or [])[:4],
            "metadata": candidate.metadata or {},
        })

    prompt = f"""
You are reranking catalog items for a buyer inquiry.
Return strict JSON only:
{{
  "ranked_ids": ["candidate-id"]
}}

Rules:
- Rank only from the provided candidate ids.
- Prioritize the item(s) that best match the user's actual need, constraints, compatibility, symptoms, use case, target user, or desired outcome.
- Use the structured fields and metadata. Do not rely on one industry or category list.
- Prefer specific matches over generic ones.
- If multiple items are relevant, return the best ones first.
- Return at most {limit} ids.
- If none are relevant, return an empty list.

User query:
{query}

Candidates:
{json.dumps(serialized_candidates, ensure_ascii=False)}
"""

    try:
        completion = llm_client.client.chat.completions.create(
            model=llm_client.model,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw_content = (completion.choices[0].message.content or "").strip()
        parsed = json.loads(raw_content)
        ranked_ids = parsed.get("ranked_ids")
        if isinstance(ranked_ids, list):
            allowed_ids = {candidate["id"] for candidate in serialized_candidates}
            clean_ids: List[str] = []
            for candidate_id in ranked_ids:
                candidate_id = str(candidate_id).strip()
                if candidate_id and candidate_id in allowed_ids and candidate_id not in clean_ids:
                    clean_ids.append(candidate_id)
                if len(clean_ids) >= limit:
                    break
            return {"ranked_ids": clean_ids, "mode": "ai"}
    except Exception:
        return {"ranked_ids": [], "mode": "error"}

    return {"ranked_ids": [], "mode": "error"}


@router.post("/drafts/generate")
def generate_draft(
    payload: GenerateDraftRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # Enforce Internal Service Authentication
    secret_header = extract_internal_secret(request)
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    
    if not env_secret:
         raise HTTPException(status_code=500, detail="Internal configuration error")

    if not secret_header or secret_header != env_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    # Enforce Account Scope
    account_header = request.headers.get("X-Account-Id")
    if not account_header:
         raise HTTPException(status_code=400, detail="Missing X-Account-Id header")
    
    if account_header != payload.account_id:
        raise HTTPException(status_code=403, detail="Account ID mismatch between header and payload")

    llm_client = LLMClient()
    svc = DraftGenerationService(db, llm_client)
    try:
        return svc.generate_draft(
            lead_id=payload.lead_id,
            account_id=payload.account_id,
            force=payload.force,
            owner_settings={
                **(payload.owner_settings or {}),
                "comment_text": payload.comment_text,
                "brand_name": payload.brand_name,
                "brand_domain": payload.brand_domain,
                "platform": payload.platform,
                "buyer_stage": payload.buyer_stage,
                "intent": payload.intent,
                "product_context": payload.product_context,
                "knowledge_context": payload.knowledge_context,
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

class NormalizationRequest(BaseModel):
    text: str

@router.post("/normalize")
def normalize_text(
    payload: NormalizationRequest,
    request: Request
):
    # Public/Internal endpoint for standalone normalization
    # Check secret
    secret_header = extract_internal_secret(request)
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    if not env_secret or secret_header != env_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
        
    result = normalization_service.normalize(payload.text)
    return result.to_dict()

class RelevanceCheckRequest(BaseModel):
    brand_id: str
    text: str # Combined title + description + comments
    platform: str
    metadata: Optional[Dict[str, Any]] = {}

@router.post("/relevance/check")
async def check_relevance(
    payload: RelevanceCheckRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # 1. Auth & Context
    secret_header = extract_internal_secret(request)
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    if not env_secret or secret_header != env_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    # 2. Fetch Brand Context
    from shared.database.models import Brand
    brand = db.query(Brand).filter(Brand.id == payload.brand_id).first()
    
    if not brand:
         # Fallback to permissive or strict? 
         # Strict: If brand unknown, we can't judge relevance.
         raise HTTPException(status_code=404, detail=f"Brand {payload.brand_id} not found")

    # 3. Construct Query from Brand Context
    # Context expected: { "niche": "Skin Care", "keywords": ["acne", "routine"] }
    context = brand.domain_context or {}
    niche = context.get("niche", "general")
    keywords = context.get("keywords", [])
    
    # --- PHASE 37.3: NORMALIZATION ---
    # Step 1: Normalize
    norm_result = normalization_service.normalize(payload.text)
    normalized_text = norm_result.normalized_text
    
    # Step 2: Enforcement (Confidence Cap)
    is_uncertain = False
    score_cap = 1.0
    if norm_result.confidence < NormalizationService.CONFIDENCE_THRESHOLD_ACCEPT:
        is_uncertain = True
        score_cap = 0.5 # Cap score at 0.5 (Uncertain)
        logger = logging.getLogger("ai_core.api.internal")
        logger.warning(f"Low confidence normalization ({norm_result.confidence}) for text: {payload.text[:50]}...")
    
    # Use Normalized Text for Scoring
    query = f"{niche} {' '.join(keywords)} high purchase intent"

    # 4. Score
    cap = request.app.state.capabilities.get("score")
    if not cap:
        raise HTTPException(status_code=500, detail="Score capability not ready")

    # We use ScoreCapability to rerank a single item against the query
    from ai_core.contracts.capability_request import CapabilityRequest
    
    cap_req = CapabilityRequest(
        tenant_id="system", # Internal
        user_id="automation_agent",
        roles=["internal"],
        channel="internal",
        input={
            "query": query,
            "retrieved": [normalized_text] # Use Normalized
        },
        context={},
        trace_id=request.headers.get("X-Correlation-ID")
    )

    result = await cap.execute(cap_req)
    
    if result.kind == "error":
        raise HTTPException(status_code=500, detail="Scoring failed")

    # Payload is [{ "text": "...", "score": 0.9 }]
    scored_items = result.payload
    if not scored_items:
         return {"relevant": False, "confidence": 0.0, "reason": "No score returned", "normalization": norm_result.to_dict()}

    top_item = scored_items[0]
    raw_score = top_item.get("score", 0.0)
    
    # Apply Cap
    final_score = min(raw_score, score_cap)
    
    # 5. Decision Logic
    # Threshold could be in Brand Context too
    threshold = context.get("relevance_threshold", 0.4) # Default conservative
    
    is_relevant = final_score >= threshold
    
    reason = f"Score {final_score:.2f} >= {threshold} for niche {niche}"
    if is_uncertain:
        reason += " [Language Uncertain]"
    
    return {
        "relevant": is_relevant,
        "confidence": final_score,
        "reason": reason,
        "normalization": norm_result.to_dict() # Return Meta
    }
