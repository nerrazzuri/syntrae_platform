"""
Qdrant vector database service for document embeddings and similarity search.
"""
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)
import logging
from shared.config.settings import settings
from shared.config.tuning import retrieval, quant
from shared.utils.circuit_breaker import circuit_breaker
from shared.utils.retry import retry_with_backoff
from shared.metrics.reliability_metrics import reliability_metrics

logger = logging.getLogger(__name__)


class QdrantService:
    """Qdrant vector database service with tenant isolation."""

    def __init__(self, url: Optional[str] = None, api_key: Optional[str] = None):
        self._url = url or settings.qdrant_url
        self._api_key = api_key or settings.qdrant_api_key
        self.client = QdrantClient(url=self._url, api_key=self._api_key)
        self.collection_name = "knowledge_chunks"
        self.schema_collection = "schema_fields"
        self.field_values_collection = "field_values"
        # Resolve vector size dynamically based on embedding model
        self.vector_size = self._resolve_vector_size()
        self._last_health_ts = 0.0

    def _resolve_vector_size(self) -> int:
        """Return the expected vector size based on configured embedding model.

        - text-embedding-3-large: 3072
        - text-embedding-3-small: 1536
        - bge-large-en-v1.5: 1024 (common); fallback to 1536 for unknowns
        """
        model = (retrieval.embedding_model or "").lower()
        try:
            if "text-embedding-3-large" in model:
                return 3072
            if "text-embedding-3-small" in model:
                return 1536
            if "bge-large" in model:
                return 1024
        except Exception:
            pass
        return 1536

    def _ensure_client(self) -> None:
        """Recreate Qdrant client if needed."""
        if self.client is None:
            self.client = QdrantClient(url=self._url, api_key=self._api_key)

    def _with_retries(self, func, *args, **kwargs):
        @retry_with_backoff("qdrant.call")
        def _runner():
            return func(*args, **kwargs)

        try:
            if not circuit_breaker.allow("qdrant", tenant_id=None):
                raise RuntimeError("circuit_open")
            self._ensure_client()
            res = _runner()
            circuit_breaker.record_success("qdrant", tenant_id=None)
            return res
        except Exception as e:  # noqa: BLE001
            circuit_breaker.record_failure("qdrant", tenant_id=None)
            reliability_metrics.inc_retry("qdrant.call")
            raise e

    def ping(self) -> bool:
        try:
            self._ensure_client()
            _ = self.client.get_collections()
            circuit_breaker.record_success("qdrant", tenant_id=None)
            return True
        except Exception:
            circuit_breaker.record_failure("qdrant", tenant_id=None)
            return False

    def create_collection(self) -> None:
        """Create the knowledge chunks collection if it doesn't exist."""
        try:
            # Check if collection exists (with retries while Qdrant warms up)
            collections = self._with_retries(self.client.get_collections)
            collection_names = [col.name for col in collections.collections]

            if self.collection_name not in collection_names:
                self._with_retries(
                    self.client.create_collection,
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.vector_size, distance=Distance.COSINE
                    ),
                )
                logger.info(f"Created Qdrant collection: {self.collection_name}")

                # Create payload index for tenant filtering
                self._with_retries(
                    self.client.create_payload_index,
                    collection_name=self.collection_name,
                    field_name="tenant_id",
                    field_schema="keyword",
                )
                logger.info("Created tenant_id payload index")
                # RBAC payload indices
                for fname, ftype in (
                    ("visibility", "keyword"),
                    ("owner_user_id", "keyword"),
                    ("allowed_user_ids", "keyword"),
                ):
                    try:
                        self._with_retries(
                            self.client.create_payload_index,
                            collection_name=self.collection_name,
                            field_name=fname,
                            field_schema=ftype,
                        )
                    except Exception:
                        pass
                # Create payload indices for chapter metadata to speed chapter queries
                try:
                    self._with_retries(
                        self.client.create_payload_index,
                        collection_name=self.collection_name,
                        field_name="chapter_num",
                        field_schema="integer",
                    )
                    self._with_retries(
                        self.client.create_payload_index,
                        collection_name=self.collection_name,
                        field_name="chapter_title",
                        field_schema="text",
                    )
                    logger.info("Created chapter_num and chapter_title payload indices")
                except Exception as ie:
                    logger.warning(f"Chapter payload index creation skipped: {ie}")
            else:
                logger.info(f"Collection {self.collection_name} already exists")

        except Exception as e:
            # Degrade gracefully; caller may retry later
            logger.warning(
                f"Failed to create Qdrant collection (will retry later): {e}"
            )
            # Try a soft reconnect once
            try:
                self.client = QdrantClient(url=self._url, api_key=self._api_key)
            except Exception:
                pass

        # Ensure schema collection exists as well
        try:
            collections = self._with_retries(self.client.get_collections)
            collection_names = [col.name for col in collections.collections]
            if self.schema_collection not in collection_names:
                self._with_retries(
                    self.client.create_collection,
                    collection_name=self.schema_collection,
                    vectors_config=VectorParams(
                        size=self.vector_size, distance=Distance.COSINE
                    ),
                )
                logger.info(f"Created Qdrant collection: {self.schema_collection}")
                # Payload index for tenant filtering
                self._with_retries(
                    self.client.create_payload_index,
                    collection_name=self.schema_collection,
                    field_name="tenant_id",
                    field_schema="keyword",
                )
                # Field name index for filtering/searching
                try:
                    self._with_retries(
                        self.client.create_payload_index,
                        collection_name=self.schema_collection,
                        field_name="field_name",
                        field_schema="keyword",
                    )
                except Exception:
                    pass
            else:
                logger.info(f"Collection {self.schema_collection} already exists")
        except Exception as e:
            logger.warning(
                f"Failed to create schema collection (will retry later): {e}"
            )

        # Ensure field_values collection exists
        try:
            collections = self._with_retries(self.client.get_collections)
            collection_names = [col.name for col in collections.collections]
            if self.field_values_collection not in collection_names:
                self._with_retries(
                    self.client.create_collection,
                    collection_name=self.field_values_collection,
                    vectors_config=VectorParams(
                        size=self.vector_size, distance=Distance.COSINE
                    ),
                )
                logger.info(
                    f"Created Qdrant collection: {self.field_values_collection}"
                )
                # Payload indices for filtering
                for fname, ftype in (
                    ("tenant_id", "keyword"),
                    ("document_id", "keyword"),
                    ("field_name", "keyword"),
                    # RBAC fields
                    ("visibility", "keyword"),
                    ("owner_user_id", "keyword"),
                    ("allowed_user_ids", "keyword"),
                ):
                    try:
                        self._with_retries(
                            self.client.create_payload_index,
                            collection_name=self.field_values_collection,
                            field_name=fname,
                            field_schema=ftype,
                        )
                    except Exception:
                        pass
            else:
                logger.info(f"Collection {self.field_values_collection} already exists")
        except Exception as e:
            logger.warning(
                f"Failed to create field_values collection (will retry later): {e}"
            )

    def upsert_knowledge_chunks(
        self, tenant_id: str, chunks: List[Dict[str, Any]]
    ) -> None:
        """Upsert knowledge chunks for a specific tenant."""
        try:
            collection_name = self.collection_name
            points = []
            for chunk in chunks:
                vec = chunk["embedding"]
                if quant.enabled and isinstance(vec, list):
                    try:
                        # Simple rounding quantization
                        qvec = [round(float(x), quant.decimals) for x in vec]
                    except Exception:
                        qvec = vec
                else:
                    qvec = vec
                point = PointStruct(
                    id=chunk["id"],
                    vector=qvec,
                    payload={
                        "tenant_id": tenant_id,
                        "document_id": chunk["document_id"],
                        "document_title": chunk.get("document_title"),
                        "content": chunk["content"],
                        "chunk_index": chunk["chunk_index"],
                        # include structured fields if present
                        "chapter_num": chunk.get("chapter_num"),
                        "chapter_title": chunk.get("chapter_title"),
                        "page": chunk.get("page"),
                        # retain any nested metadata
                        "metadata": chunk.get("metadata", {}),
                        # RBAC fields (optional, for filtering)
                        "visibility": chunk.get("visibility"),
                        "owner_user_id": chunk.get("owner_user_id"),
                        "allowed_user_ids": chunk.get("allowed_user_ids"),
                    },
                )
                points.append(point)

            if points:
                self._with_retries(
                    self.client.upsert, collection_name=collection_name, points=points
                )
                logger.info(
                    f"Upserted {len(points)} knowledge chunks for tenant {tenant_id}"
                )

        except Exception as e:
            # Degrade gracefully; embeddings remain available in SQL, upsert can be retried later
            logger.warning(
                f"Failed to upsert knowledge chunks for tenant {tenant_id} (will retry later): {e}"
            )

    def upsert_schema_fields(
        self, tenant_id: str, fields: List[Dict[str, Any]]
    ) -> None:
        """Upsert schema field embeddings for a tenant.

        Each item in fields should have: {"id": str, "embedding": List[float], "field_name": str, "description": str}
        """
        try:
            points = []
            for f in fields:
                point = PointStruct(
                    id=f["id"],
                    vector=f["embedding"],
                    payload={
                        "tenant_id": tenant_id,
                        "field_name": f.get("field_name"),
                        "description": f.get("description", ""),
                        "kind": "schema",
                        # Optional enriched payload
                        "aliases": f.get("aliases", []),
                        "category": f.get("category"),
                        "tokens": f.get("tokens", []),
                    },
                )
                points.append(point)
            if points:
                self._with_retries(
                    self.client.upsert,
                    collection_name=self.schema_collection,
                    points=points,
                )
                logger.info(
                    f"Upserted {len(points)} schema fields for tenant {tenant_id}"
                )
        except Exception as e:
            logger.warning(
                f"Failed to upsert schema fields for tenant {tenant_id}: {e}"
            )

    def search_schema_fields(
        self,
        query_embedding: List[float],
        tenant_id: str,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search schema fields by embedding for a tenant."""
        try:
            filter_condition = Filter(
                must=[
                    FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                ]
            )
            search_results = self._with_retries(
                self.client.search,
                collection_name=self.schema_collection,
                query_vector=query_embedding,
                query_filter=filter_condition,
                limit=top_k,
            )
            results = []
            for r in search_results:
                results.append(
                    {
                        "id": r.id,
                        "score": r.score,
                        "payload": r.payload,
                    }
                )
            return results
        except Exception as e:
            logger.warning(
                f"Failed to search schema fields for tenant {tenant_id}: {e}"
            )
            return []

    def list_schema_fields(
        self, tenant_id: str, limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """List schema field points for a tenant."""
        try:
            collected: List[Dict[str, Any]] = []
            next_page = None
            fetched = 0
            while fetched < limit:
                response = self._with_retries(
                    self.client.scroll,
                    collection_name=self.schema_collection,
                    scroll_filter=Filter(
                        must=[
                            FieldCondition(
                                key="tenant_id", match=MatchValue(value=tenant_id)
                            )
                        ]
                    ),
                    with_payload=True,
                    with_vectors=False,
                    limit=min(256, limit - fetched),
                    offset=next_page,
                )
                if not response or not response[0]:
                    break
                points, next_page = response
                for p in points:
                    collected.append(
                        {
                            "id": p.id,
                            "payload": p.payload or {},
                        }
                    )
                fetched += len(points)
                if not next_page:
                    break
            return collected
        except Exception as e:
            logger.warning(f"list_schema_fields failed: {e}")
            return []

    def delete_schema_fields_by_ids(self, tenant_id: str, ids: List[Any]) -> bool:
        """Delete schema field points by IDs for a tenant."""
        if not ids:
            return True
        try:
            from qdrant_client.models import HasIdCondition

            self._with_retries(
                self.client.delete,
                collection_name=self.schema_collection,
                points_selector=HasIdCondition(has_id=ids),
            )
            logger.info(f"Deleted {len(ids)} schema fields for tenant {tenant_id}")
            return True
        except Exception as e:
            logger.warning(f"delete_schema_fields_by_ids failed: {e}")
            return False

    def upsert_field_values(self, tenant_id: str, items: List[Dict[str, Any]]) -> None:
        """Upsert field-value embeddings for a tenant.

        Each item: {id, embedding, document_id, row_index, field_name, field_display, value_raw, value_norm, sheet, source_file, record_sig}
        """
        try:
            points = []
            for it in items:
                point = PointStruct(
                    id=it["id"],
                    vector=it["embedding"],
                    payload={
                        "tenant_id": tenant_id,
                        "document_id": it.get("document_id"),
                        "row_index": it.get("row_index"),
                        "field_name": it.get("field_name"),
                        "field_display": it.get("field_display"),
                        "value_raw": it.get("value_raw"),
                        "value_norm": it.get("value_norm"),
                        "sheet": it.get("sheet"),
                        "source_file": it.get("source_file"),
                        "record_sig": it.get("record_sig"),
                        "kind": "field_value",
                    },
                )
                points.append(point)
            if points:
                self._with_retries(
                    self.client.upsert,
                    collection_name=self.field_values_collection,
                    points=points,
                )
                logger.info(
                    f"Upserted {len(points)} field_values for tenant {tenant_id}"
                )
        except Exception as e:
            logger.warning(f"Failed to upsert field_values for tenant {tenant_id}: {e}")

    def search_field_values(
        self,
        query_embedding: List[float],
        tenant_id: str,
        top_k: int = 8,
        user_id: Optional[str] = None,
        role: Optional[str] = None,
        allowed_document_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Search field_values collection for a tenant."""
        try:
            must = [FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]
            if (role or "").upper() != "ADMIN":
                should = [
                    FieldCondition(key="visibility", match=MatchValue(value="public")),
                    FieldCondition(key="visibility", match=MatchValue(value="tenant")),
                ]
                if user_id:
                    should.append(
                        FieldCondition(
                            key="owner_user_id", match=MatchValue(value=user_id)
                        )
                    )
                    should.append(
                        FieldCondition(
                            key="allowed_user_ids", match=MatchValue(value=user_id)
                        )
                    )
                # Optional narrowing by document IDs
                if isinstance(allowed_document_ids, list) and allowed_document_ids:
                    for did in allowed_document_ids[:1000]:
                        try:
                            should.append(
                                FieldCondition(
                                    key="document_id", match=MatchValue(value=str(did))
                                )
                            )
                        except Exception:
                            continue
                filter_condition = Filter(must=must, should=should)
            else:
                filter_condition = Filter(must=must)
            res = self._with_retries(
                self.client.search,
                collection_name=self.field_values_collection,
                query_vector=query_embedding,
                query_filter=filter_condition,
                limit=top_k,
            )
            out: List[Dict[str, Any]] = []
            for r in res:
                out.append(
                    {
                        "id": r.id,
                        "score": r.score,
                        "payload": r.payload,
                    }
                )
            return out
        except Exception as e:
            logger.warning(f"search_field_values failed: {e}")
            return []

    def delete_field_values_for_document(
        self, tenant_id: str, document_id: str
    ) -> bool:
        """Delete field_values for a document in a tenant."""
        try:
            flt = Filter(
                must=[
                    FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                    FieldCondition(
                        key="document_id", match=MatchValue(value=document_id)
                    ),
                ]
            )
            self._with_retries(
                self.client.delete,
                collection_name=self.field_values_collection,
                points_selector=flt,
            )
            return True
        except Exception as e:
            logger.warning(f"delete_field_values_for_document failed: {e}")
            return False

    def search_similar_chunks(
        self,
        query_embedding: List[float],
        tenant_id: str,
        top_k: int = 5,
        threshold: float = 0.7,
        user_id: Optional[str] = None,
        role: Optional[str] = None,
        allowed_document_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Search for similar knowledge chunks within a tenant."""
        try:
            must = [FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]
            if (role or "").upper() != "ADMIN":
                should = [
                    FieldCondition(key="visibility", match=MatchValue(value="public")),
                    FieldCondition(key="visibility", match=MatchValue(value="tenant")),
                ]
                if user_id:
                    should.append(
                        FieldCondition(
                            key="owner_user_id", match=MatchValue(value=user_id)
                        )
                    )
                    should.append(
                        FieldCondition(
                            key="allowed_user_ids", match=MatchValue(value=user_id)
                        )
                    )
                # Optional narrowing by document IDs
                if isinstance(allowed_document_ids, list) and allowed_document_ids:
                    for did in allowed_document_ids[:1000]:
                        try:
                            should.append(
                                FieldCondition(
                                    key="document_id", match=MatchValue(value=str(did))
                                )
                            )
                        except Exception:
                            continue
                filter_condition = Filter(must=must, should=should)
            else:
                filter_condition = Filter(must=must)

            # Search with filter
            collection_name = self.collection_name
            search_results = self._with_retries(
                self.client.search,
                collection_name=collection_name,
                query_vector=query_embedding,
                query_filter=filter_condition,
                limit=top_k,
                score_threshold=threshold,
            )

            # Format results
            results = []
            for result in search_results:
                results.append(
                    {"id": result.id, "score": result.score, "payload": result.payload}
                )

            logger.info(f"Found {len(results)} similar chunks for tenant {tenant_id}")
            return results

        except Exception as e:
            logger.error(f"Failed to search similar chunks for tenant {tenant_id}: {e}")
            return []

    def delete_tenant_chunks(self, tenant_id: str) -> bool:
        """Delete all knowledge chunks for a specific tenant."""
        try:
            filter_condition = Filter(
                must=[
                    FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))
                ]
            )

            collection_name = self.collection_name
            self._with_retries(
                self.client.delete,
                collection_name=collection_name,
                points_selector=filter_condition,
            )

            logger.info(f"Deleted all knowledge chunks for tenant {tenant_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete chunks for tenant {tenant_id}: {e}")
            return False

    def get_collection_info(self) -> Dict[str, Any]:
        """Get information about the knowledge chunks collection."""
        try:
            collection_info = self._with_retries(
                self.client.get_collection, self.collection_name
            )
            return {
                "name": collection_info.name,
                "vectors_count": collection_info.points_count,
                "status": "active",
            }
        except Exception as e:
            logger.error(f"Failed to get collection info: {e}")
            return {"status": "error", "error": str(e)}

    def get_adjacent_chunks(
        self, tenant_id: str, document_id: str, start_index: int, window: int = 2
    ) -> List[Dict[str, Any]]:
        """Fetch neighbor chunks around a given chunk index for stitching.

        Note: Qdrant doesn't support range by chunk_index directly; we scroll and filter in client for simplicity.
        """
        try:
            collection_name = self.collection_name
            res = self._with_retries(
                self.client.scroll,
                collection_name=collection_name,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="tenant_id", match=MatchValue(value=tenant_id)
                        ),
                        FieldCondition(
                            key="document_id", match=MatchValue(value=document_id)
                        ),
                    ]
                ),
                with_payload=True,
                with_vectors=False,
                limit=512,
            )
            points = res[0] if res and res[0] else []
            neighbors: List[Dict[str, Any]] = []
            for p in points:
                pl = p.payload or {}
                try:
                    idx = int(pl.get("chunk_index", -999999))
                except Exception:
                    continue
                if abs(idx - start_index) <= window and idx != start_index:
                    neighbors.append(pl)
            # Sort by chunk_index
            neighbors.sort(key=lambda x: int(x.get("chunk_index", 0)))
            return neighbors
        except Exception as e:
            logger.warning(f"get_adjacent_chunks failed: {e}")
            return []

    def list_chapters(self, tenant_id: str, limit: int = 1000) -> List[Dict[str, Any]]:
        """Return points that have chapter_num or chapter_title for a tenant.

        Uses scroll to page through limited results. Best-effort; returns empty on error.
        """
        try:
            from qdrant_client.models import Filter, FieldCondition

            collected: List[Dict[str, Any]] = []
            next_page = None
            fetched = 0
            while fetched < limit:
                response = self._with_retries(
                    self.client.scroll,
                    collection_name=self.collection_name,
                    scroll_filter=Filter(
                        must=[
                            FieldCondition(
                                key="tenant_id", match=MatchValue(value=tenant_id)
                            )
                        ]
                    ),
                    with_payload=True,
                    with_vectors=False,
                    limit=min(256, limit - fetched),
                    offset=next_page,
                )
                if not response or not response[0]:
                    break
                points, next_page = response
                for p in points:
                    pl = p.payload or {}
                    if (pl.get("chapter_num") is not None) or (pl.get("chapter_title")):
                        collected.append(pl)
                fetched += len(points)
                if not next_page:
                    break
            return collected
        except Exception as e:
            logger.warning(f"list_chapters failed: {e}")
            return []


# Global vector service instance (configured via environment settings)
qdrant_service = QdrantService()
