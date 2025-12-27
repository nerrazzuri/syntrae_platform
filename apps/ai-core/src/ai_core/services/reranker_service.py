"""
Advanced Reranking Service for RAG pipeline.
Implements multi-stage reranking with cross-encoder and learning-to-rank.
Production-ready with caching, monitoring, and error handling.
"""
import numpy as np
from typing import List, Dict, Tuple, Any, Optional
import asyncio
from concurrent.futures import ThreadPoolExecutor
import time
import hashlib
import re
import logging
from dataclasses import dataclass
from contextlib import asynccontextmanager

# ML Libraries
import os

# Robust HTTPError import (requests if available, else urllib, else define)
try:
    from requests.exceptions import HTTPError  # type: ignore
except Exception:  # pragma: no cover
    try:
        from urllib.error import HTTPError  # type: ignore
    except Exception:  # pragma: no cover

        class HTTPError(Exception):
            pass


# Local imports
from shared.cache.redis import redis_cache
from shared.config.tuning import reranker_config
import logging

logger = logging.getLogger(__name__)


@dataclass
class RankingFeatures:
    """Features for learning-to-rank model."""

    bi_encoder_score: float
    cross_encoder_score: float
    bm25_score: float
    query_length: int
    doc_length: int
    entity_overlap: float
    semantic_similarity: float
    query_doc_overlap: float
    doc_position_rank: int
    tfidf_similarity: float

    def to_array(self) -> np.ndarray:
        """Convert to numpy array for ML models."""
        return np.array(
            [
                self.bi_encoder_score,
                self.cross_encoder_score,
                self.bm25_score,
                self.query_length,
                self.doc_length,
                self.entity_overlap,
                self.semantic_similarity,
                self.query_doc_overlap,
                self.doc_position_rank,
                self.tfidf_similarity,
            ]
        )


@dataclass
class RerankingResult:
    """Result of reranking operation."""

    documents: List[str]
    scores: List[float]
    original_indices: List[int]
    processing_time: float
    method_used: str  # 'cross_encoder', 'ltr', or 'fusion'


class RerankerCache:
    """Specialized cache for reranking operations."""

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.default_ttl = reranker_config.cache_ttl
        self.cross_encoder_ttl = reranker_config.cache_ttl * 2

    def _get_cache_key(self, query: str, docs: List[str], method: str) -> str:
        """Generate cache key for reranking operation."""
        # Use first few documents for key generation to avoid large keys
        content = f"{method}:{query}:{'|'.join(docs[:3])}"
        return hashlib.md5(content.encode()).hexdigest()

    def get_cross_encoder_scores(
        self, query: str, docs: List[str]
    ) -> Optional[List[float]]:
        """Get cached CrossEncoder scores."""
        if not self.enabled:
            return None

        cache_key = f"rerank:cross:{self._get_cache_key(query, docs, 'cross')}"
        cached_data = redis_cache.get_tenant_key("global", cache_key)

        if cached_data and isinstance(cached_data, list):
            logger.debug(f"CrossEncoder cache hit for query: {query[:50]}...")
            return cached_data

        return None

    def set_cross_encoder_scores(
        self, query: str, docs: List[str], scores: List[float]
    ):
        """Cache CrossEncoder scores."""
        if not self.enabled:
            return

        cache_key = f"rerank:cross:{self._get_cache_key(query, docs, 'cross')}"
        redis_cache.set_tenant_key("global", cache_key, scores, self.cross_encoder_ttl)
        logger.debug(f"Cached CrossEncoder scores for {len(docs)} documents")

    def get_ltr_scores(self, query: str, docs: List[str]) -> Optional[List[float]]:
        """Get cached LTR scores."""
        if not self.enabled:
            return None

        cache_key = f"rerank:ltr:{self._get_cache_key(query, docs, 'ltr')}"
        return redis_cache.get_tenant_key("global", cache_key)

    def set_ltr_scores(self, query: str, docs: List[str], scores: List[float]):
        """Cache LTR scores."""
        if not self.enabled:
            return

        cache_key = f"rerank:ltr:{self._get_cache_key(query, docs, 'ltr')}"
        redis_cache.set_tenant_key("global", cache_key, scores, self.default_ttl)


class AdvancedReranker:
    """
    Advanced multi-stage reranking system for RAG pipelines.

    Stages:
    1. BiEncoder filtering (or BM25 fallback)
    2. CrossEncoder precise scoring
    3. Learning-to-Rank fusion (if model available)
    4. Weighted fusion fallback
    """

    def __init__(
        self,
        cross_encoder_model: Optional[str] = None,
        ltr_model_path: Optional[str] = None,
        enable_async: bool = True,
    ):
        # Configuration: detect torch lazily (optional)
        try:
            import torch as _torch  # type: ignore

            self._torch_available = True
            self.device = (
                "cuda"
                if getattr(_torch, "cuda", None) and _torch.cuda.is_available()
                else "cpu"
            )
        except Exception:
            self._torch_available = False
            self.device = "cpu"
        self.enable_async = enable_async
        self.cache = RerankerCache(reranker_config.cache_enabled)

        # CrossEncoder setup (lazy import with robust fallbacks)
        requested_model = (
            cross_encoder_model or reranker_config.cross_encoder_model or ""
        ).strip()
        fallback_models = [
            requested_model,
            "cross-encoder/ms-marco-MiniLM-L6-v2",
            "cross-encoder/ms-marco-electra-base",
            "cross-encoder/ms-marco-TinyBERT-L-2-v2",
        ]
        # de-duplicate while preserving order
        seen = set()
        models_to_try = []
        for m in fallback_models:
            if m and m not in seen:
                seen.add(m)
                models_to_try.append(m)

        self.cross_encoder = None
        self.cross_encoder_available = False
        try:
            from sentence_transformers import CrossEncoder as _CrossEncoder
        except Exception as e:
            logger.error(f"sentence-transformers import failed: {e}")
            models_to_try = []  # can't proceed without library

        for model_name in models_to_try:
            try:
                # logger.info(f"Loading CrossEncoder: {model_name} on {self.device}")
                print(f"Loading CrossEncoder: {model_name} on {self.device}")
                self.cross_encoder = _CrossEncoder(
                    model_name,
                    device=self.device,
                    max_length=reranker_config.cross_encoder_max_length,
                )
                self.cross_encoder_available = True
                # logger.info(f"CrossEncoder loaded: {model_name}")
                print(f"CrossEncoder loaded: {model_name}")
                break
            except (OSError, HTTPError, RuntimeError) as e:
                import traceback

                print("Exception Type:", type(e))
                print("Args:", e.args)
                traceback.print_exc()
                logger.warning(f"Model {model_name} could not be loaded: {e}")
                continue
            except Exception as e:
                logger.error(f"Failed to load CrossEncoder '{model_name}': {e}")
                self.cross_encoder = None
                self.cross_encoder_available = False
                import shutil, os

                cache_path = os.path.expanduser(
                    f"~/.cache/huggingface/hub/models--{model_name.replace('/', '--')}"
                )
                if os.path.exists(cache_path):
                    shutil.rmtree(cache_path, ignore_errors=True)

        # Learning-to-Rank setup
        self.ltr_model = None
        # StandardScaler (lazy import; fallback to pass-through)
        try:
            from sklearn.preprocessing import StandardScaler as _StandardScaler

            self.feature_scaler = _StandardScaler()
        except Exception:

            class _PassThroughScaler:
                def fit_transform(self, X):
                    return X

                def transform(self, X):
                    return X

            self.feature_scaler = _PassThroughScaler()
        self.ltr_available = False
        # LightGBM optional
        try:
            import lightgbm as _lgb

            self._lgb = _lgb
        except Exception:
            self._lgb = None
        if reranker_config.ltr_enabled and ltr_model_path:
            self.load_ltr_model(ltr_model_path)

        # Async executor for CPU-bound tasks
        if self.enable_async:
            self.executor = ThreadPoolExecutor(
                max_workers=4, thread_name_prefix="reranker"
            )

        # BM25 cache for fallback
        from ai_core.pipeline.fusion.bm25 import StandardBM25 as _SBM25  # updated path

        self._BM25_cls = _SBM25
        self.bm25_cache: Dict[str, _SBM25] = {}

        # TF-IDF vectorizer for semantic similarity
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer as _TFV

            self.tfidf_vectorizer = _TFV(max_features=1000, stop_words="english")
            self._tfidf_ok = True
        except Exception:
            self.tfidf_vectorizer = None
            self._tfidf_ok = False
        self.tfidf_fitted = False

        logger.info("AdvancedReranker initialized successfully")

    @asynccontextmanager
    async def _performance_context(self, operation: str):
        """Context manager for performance monitoring."""
        start_time = time.time()
        try:
            yield
        finally:
            duration = time.time() - start_time
            logger.info(
                f"Reranking operation '{operation}' completed in {duration:.3f}s"
            )

    def multi_stage_reranking(
        self,
        query: str,
        documents: List[str],
        bi_encoder_scores: Optional[List[float]] = None,
        top_k: int = 10,
    ) -> RerankingResult:
        """
        Multi-stage reranking pipeline.

        Args:
            query: User query
            documents: List of retrieved documents
            bi_encoder_scores: Pre-computed BiEncoder scores (optional)
            top_k: Number of final results to return

        Returns:
            RerankingResult with ranked documents and metadata
        """
        if not documents:
            return RerankingResult([], [], [], 0.0, "no_documents")

        start_time = time.time()
        original_indices = list(range(len(documents)))

        logger.info(
            f"Starting reranking for {len(documents)} documents, query: {query[:100]}..."
        )

        try:
            # Stage 1: Get BiEncoder scores or fallback to BM25
            if bi_encoder_scores is None:
                bi_encoder_scores = self._fallback_bi_encoder(query, documents)

            # Stage 2: Filter to top candidates for detailed processing
            stage1_results = list(zip(documents, bi_encoder_scores, original_indices))
            stage1_results.sort(key=lambda x: x[1], reverse=True)

            # Take top candidates for detailed processing
            max_candidates = min(50, len(stage1_results))
            top_candidates = stage1_results[:max_candidates]
            top_docs = [doc for doc, _, _ in top_candidates]
            top_bi_scores = [score for _, score, _ in top_candidates]
            top_indices = [idx for _, _, idx in top_candidates]

            # Stage 3: CrossEncoder scoring
            if self.cross_encoder_available:
                cross_scores = self._cross_encode_with_cache(query, top_docs)
            else:
                logger.warning("CrossEncoder not available, skipping stage 3")
                cross_scores = top_bi_scores  # Fallback to BiEncoder scores

            # Stage 4: Learning-to-Rank or fusion
            if self.ltr_available and len(top_docs) > 5:
                final_results = self._ltr_rerank(
                    query, top_docs, top_bi_scores, cross_scores, top_indices
                )
                method_used = "ltr"
            else:
                final_scores = self._weighted_fusion(top_bi_scores, cross_scores)
                final_results = list(zip(top_docs, final_scores, top_indices))
                method_used = "fusion"

            # Stage 5: Final ranking
            final_results.sort(key=lambda x: x[1], reverse=True)
            final_top_k = final_results[:top_k]

            processing_time = time.time() - start_time

            result = RerankingResult(
                documents=[doc for doc, _, _ in final_top_k],
                scores=[score for _, score, _ in final_top_k],
                original_indices=[idx for _, _, idx in final_top_k],
                processing_time=processing_time,
                method_used=method_used,
            )

            logger.info(
                f"Reranking completed: {len(result.documents)} results in {processing_time:.3f}s using {method_used}"
            )
            return result

        except Exception as e:
            logger.error(f"Reranking failed: {e}")
            # Return original order as fallback
            processing_time = time.time() - start_time
            return RerankingResult(
                documents=documents[:top_k],
                scores=bi_encoder_scores[:top_k]
                if bi_encoder_scores
                else [1.0] * min(top_k, len(documents)),
                original_indices=original_indices[:top_k],
                processing_time=processing_time,
                method_used="fallback",
            )

    async def async_multi_stage_reranking(
        self,
        query: str,
        documents: List[str],
        bi_encoder_scores: Optional[List[float]] = None,
        top_k: int = 10,
    ) -> RerankingResult:
        """Async version of multi_stage_reranking."""
        if not self.enable_async:
            return self.multi_stage_reranking(
                query, documents, bi_encoder_scores, top_k
            )

        loop = asyncio.get_event_loop()

        async with self._performance_context("async_reranking"):
            return await loop.run_in_executor(
                self.executor,
                self.multi_stage_reranking,
                query,
                documents,
                bi_encoder_scores,
                top_k,
            )

    def _fallback_bi_encoder(self, query: str, documents: List[str]) -> List[float]:
        """Fallback BM25 scoring when BiEncoder scores not available."""
        # Create a cache key for this document set
        docs_key = hashlib.md5("|".join(documents).encode()).hexdigest()

        if docs_key not in self.bm25_cache:
            # Import here to avoid circular imports
            self.bm25_cache[docs_key] = self._BM25_cls(documents)

        return self.bm25_cache[docs_key].score(query)

    def _cross_encode_with_cache(self, query: str, documents: List[str]) -> List[float]:
        """CrossEncoder scoring with caching."""
        # Try cache first
        cached_scores = self.cache.get_cross_encoder_scores(query, documents)
        if cached_scores and len(cached_scores) == len(documents):
            return cached_scores

        # Compute scores
        scores = self._cross_encode_batch(query, documents)

        # Cache results
        self.cache.set_cross_encoder_scores(query, documents, scores)

        return scores

    def _cross_encode_batch(self, query: str, documents: List[str]) -> List[float]:
        """Batch CrossEncoder scoring."""
        if not self.cross_encoder:
            return [1.0] * len(documents)

        # Build query-document pairs
        pairs = [(query, doc) for doc in documents]
        batch_size = reranker_config.cross_encoder_batch_size

        scores = []
        logger.info(f"CrossEncoder scoring {len(documents)} documents...")

        for i in range(0, len(pairs), batch_size):
            batch = pairs[i : i + batch_size]
            try:
                batch_scores = self.cross_encoder.predict(
                    batch, show_progress_bar=False
                )
                scores.extend(batch_scores)
            except Exception as e:
                logger.error(f"CrossEncoder batch failed: {e}")
                # Fallback scores for this batch
                scores.extend([0.0] * len(batch))

        return scores

    def _weighted_fusion(
        self, bi_scores: List[float], cross_scores: List[float]
    ) -> List[float]:
        """Weighted fusion of two score arrays."""
        bi_weight = reranker_config.fusion_bi_weight
        cross_weight = reranker_config.fusion_cross_weight

        # Normalize scores to 0-1 range
        bi_norm = self._min_max_normalize(bi_scores)
        cross_norm = self._min_max_normalize(cross_scores)

        # Weighted fusion
        fused_scores = [
            bi_weight * b + cross_weight * c for b, c in zip(bi_norm, cross_norm)
        ]

        return fused_scores

    def _ltr_rerank(
        self,
        query: str,
        documents: List[str],
        bi_scores: List[float],
        cross_scores: List[float],
        original_indices: List[int],
    ) -> List[Tuple[str, float, int]]:
        """Learning-to-Rank reranking."""
        try:
            # Extract features
            features = self._extract_ranking_features(
                query, documents, bi_scores, cross_scores
            )

            # Prepare data for LightGBM
            X = np.array([f.to_array() for f in features])
            X_scaled = self.feature_scaler.transform(X)
            # Predict scores (guard if model missing)
            if self.ltr_model is None:
                raise RuntimeError("LTR model not loaded")
            ltr_scores = self.ltr_model.predict(X_scaled)

            # Cache LTR scores
            self.cache.set_ltr_scores(query, documents, ltr_scores.tolist())

            return list(zip(documents, ltr_scores.tolist(), original_indices))

        except Exception as e:
            logger.error(f"LTR reranking failed: {e}")
            # Fallback to fusion
            fused_scores = self._weighted_fusion(bi_scores, cross_scores)
            return list(zip(documents, fused_scores, original_indices))

    def _extract_ranking_features(
        self,
        query: str,
        documents: List[str],
        bi_scores: List[float],
        cross_scores: List[float],
    ) -> List[RankingFeatures]:
        """Extract comprehensive ranking features for LTR."""
        features = []
        query_tokens = set(query.lower().split())

        for i, (doc, bi_score, cross_score) in enumerate(
            zip(documents, bi_scores, cross_scores)
        ):
            doc_tokens = set(doc.lower().split())

            feature = RankingFeatures(
                bi_encoder_score=float(bi_score),
                cross_encoder_score=float(cross_score),
                bm25_score=float(self._calculate_single_bm25_score(query, doc)),
                query_length=len(query_tokens),
                doc_length=len(doc_tokens),
                entity_overlap=self._calculate_entity_overlap(query, doc),
                semantic_similarity=self._calculate_semantic_similarity(query, doc),
                query_doc_overlap=len(query_tokens & doc_tokens)
                / max(1, len(query_tokens | doc_tokens)),
                doc_position_rank=i,
                tfidf_similarity=self._calculate_tfidf_similarity(query, doc),
            )
            features.append(feature)

        return features

    def _calculate_entity_overlap(self, query: str, doc: str) -> float:
        """Calculate entity overlap between query and document."""
        # Simple entity extraction (capitalized words and numbers)
        query_entities = set(re.findall(r"\b[A-Z][a-z]+\b|\b\d+\b", query))
        doc_entities = set(re.findall(r"\b[A-Z][a-z]+\b|\b\d+\b", doc))

        if not query_entities:
            return 0.0
        return len(query_entities & doc_entities) / len(query_entities)

    def _calculate_semantic_similarity(self, query: str, doc: str) -> float:
        """Calculate semantic similarity using word overlap."""
        query_words = set(w.lower() for w in query.split() if len(w) > 2)
        doc_words = set(w.lower() for w in doc.split() if len(w) > 2)

        if not query_words or not doc_words:
            return 0.0

        intersection = query_words & doc_words
        union = query_words | doc_words

        return len(intersection) / len(union) if union else 0.0

    def _calculate_tfidf_similarity(self, query: str, doc: str) -> float:
        """Calculate TF-IDF cosine similarity."""
        try:
            if not self._tfidf_ok:
                return 0.0
            if not self.tfidf_fitted:
                # Fit on some sample text (in production, fit on your corpus)
                sample_texts = [query, doc] + ["sample text for fitting"] * 10
                self.tfidf_vectorizer.fit(sample_texts)
                self.tfidf_fitted = True

            tfidf_matrix = self.tfidf_vectorizer.transform([query, doc])
            try:
                from sklearn.metrics.pairwise import cosine_similarity as _cos

                similarity = _cos(tfidf_matrix[0:1], tfidf_matrix[1:2])[0][0]
            except Exception:
                return 0.0
            return float(similarity)
        except Exception as e:
            logger.warning(f"TF-IDF calculation failed: {e}")
            return 0.0

    def _calculate_single_bm25_score(self, query: str, doc: str) -> float:
        """Calculate BM25 score for a single document."""
        try:
            bm25 = self._BM25_cls([doc])
            return bm25.score(query)[0]
        except Exception:
            return 0.0

    def _min_max_normalize(self, scores: List[float]) -> List[float]:
        """Min-Max normalization to [0,1] range."""
        if not scores:
            return []

        scores_array = np.array(scores)
        min_score, max_score = np.min(scores_array), np.max(scores_array)

        if max_score == min_score:
            return [1.0] * len(scores)

        normalized = (scores_array - min_score) / (max_score - min_score)
        return normalized.tolist()

    def train_ltr_model(
        self,
        training_data: List[Dict[str, Any]],
        validation_data: List[Dict[str, Any]] = None,
    ):
        """
        Train Learning-to-Rank model.

        Args:
            training_data: List of training examples with features and labels
            validation_data: Optional validation data for early stopping
        """
        logger.info("Starting LTR model training...")

        try:
            # Extract features and labels
            features = []
            labels = []
            groups = []  # LightGBM requires group information

            current_group_size = 0
            for data_point in training_data:
                feature_vector = self._extract_features_from_data(data_point)
                features.append(feature_vector)
                labels.append(data_point["relevance_score"])
                current_group_size += 1

                # Detect query boundaries (simplified)
                if data_point.get("query_boundary", False):
                    groups.append(current_group_size)
                    current_group_size = 0

            if current_group_size > 0:
                groups.append(current_group_size)

            # Convert to numpy arrays
            X = np.array(features)
            y = np.array(labels)

            # Feature scaling
            X_scaled = self.feature_scaler.fit_transform(X)

            # Train LightGBM
            if self._lgb is None:
                raise RuntimeError("LightGBM not available")
            self.ltr_model = self._lgb.LGBMRanker(
                objective="lambdarank",
                metric="ndcg",
                num_leaves=31,
                learning_rate=0.05,
                feature_fraction=0.9,
                bagging_fraction=0.8,
                bagging_freq=5,
                verbose=1,
            )

            # Training with validation
            if validation_data:
                val_features, val_labels, val_groups = self._prepare_validation_data(
                    validation_data
                )
                val_X_scaled = self.feature_scaler.transform(val_features)

                self.ltr_model.fit(
                    X_scaled,
                    y,
                    group=groups,
                    eval_set=[(val_X_scaled, val_labels)],
                    eval_group=[val_groups],
                    eval_names=["validation"],
                    early_stopping_rounds=50,
                    verbose_eval=10,
                )
            else:
                self.ltr_model.fit(X_scaled, y, group=groups)

            self.ltr_available = True
            logger.info("LTR model training completed successfully")

        except Exception as e:
            logger.error(f"LTR training failed: {e}")
            self.ltr_available = False

    def _extract_features_from_data(self, data_point: Dict[str, Any]) -> np.ndarray:
        """Extract features from training data point."""
        feature = RankingFeatures(
            bi_encoder_score=data_point.get("bi_encoder_score", 0.0),
            cross_encoder_score=data_point.get("cross_encoder_score", 0.0),
            bm25_score=data_point.get("bm25_score", 0.0),
            query_length=data_point.get("query_length", 0),
            doc_length=data_point.get("doc_length", 0),
            entity_overlap=data_point.get("entity_overlap", 0.0),
            semantic_similarity=data_point.get("semantic_similarity", 0.0),
            query_doc_overlap=data_point.get("query_doc_overlap", 0.0),
            doc_position_rank=data_point.get("doc_position_rank", 0),
            tfidf_similarity=data_point.get("tfidf_similarity", 0.0),
        )
        return feature.to_array()

    def _prepare_validation_data(
        self, validation_data: List[Dict[str, Any]]
    ) -> Tuple[np.ndarray, np.ndarray, List[int]]:
        """Prepare validation data for LightGBM."""
        features = []
        labels = []
        groups = []

        current_group_size = 0
        for data_point in validation_data:
            feature_vector = self._extract_features_from_data(data_point)
            features.append(feature_vector)
            labels.append(data_point["relevance_score"])
            current_group_size += 1

            if data_point.get("query_boundary", False):
                groups.append(current_group_size)
                current_group_size = 0

        if current_group_size > 0:
            groups.append(current_group_size)

        return np.array(features), np.array(labels), groups

    def save_ltr_model(self, model_path: str):
        """Save trained LTR model and scaler."""
        if self.ltr_model is not None:
            try:
                import joblib  # lazy import

                model_data = {
                    "model": self.ltr_model,
                    "scaler": self.feature_scaler,
                    "feature_names": [
                        "bi_encoder_score",
                        "cross_encoder_score",
                        "bm25_score",
                        "query_length",
                        "doc_length",
                        "entity_overlap",
                        "semantic_similarity",
                        "query_doc_overlap",
                        "doc_position_rank",
                        "tfidf_similarity",
                    ],
                }
                joblib.dump(model_data, model_path)
                logger.info(f"LTR model saved to {model_path}")
            except Exception as e:
                logger.error(f"Failed to save LTR model: {e}")

    def load_ltr_model(self, model_path: str):
        """Load trained LTR model and scaler."""
        try:
            if os.path.exists(model_path):
                import joblib  # lazy import

                model_data = joblib.load(model_path)
                self.ltr_model = model_data["model"]
                self.feature_scaler = model_data["scaler"]
                self.ltr_available = True
                logger.info(f"LTR model loaded from {model_path}")
            else:
                logger.warning(f"LTR model not found at {model_path}")
                self.ltr_available = False
        except Exception as e:
            logger.error(f"Failed to load LTR model: {e}")
            self.ltr_available = False

    def get_model_info(self) -> Dict[str, Any]:
        """Get information about loaded models."""
        return {
            "cross_encoder_available": self.cross_encoder_available,
            "cross_encoder_model": getattr(self.cross_encoder, "model", None),
            "ltr_available": self.ltr_available,
            "device": self.device,
            "cache_enabled": self.cache.enabled,
            "async_enabled": self.enable_async,
        }

    def clear_cache(self):
        """Clear all caches."""
        self.bm25_cache.clear()
        # Redis cache clearing would be handled at the cache level
        logger.info("Reranker caches cleared")

    def __del__(self):
        """Cleanup resources."""
        if hasattr(self, "executor"):
            self.executor.shutdown(wait=True)


# Global reranker instance with lazy initialization
_global_reranker: Optional[AdvancedReranker] = None


def get_reranker() -> AdvancedReranker:
    """Get global reranker instance (lazy initialization)."""
    global _global_reranker
    if _global_reranker is None:
        _global_reranker = AdvancedReranker()
    return _global_reranker


def create_reranker(**kwargs) -> AdvancedReranker:
    """Create a new reranker instance with custom settings."""
    return AdvancedReranker(**kwargs)


# Convenience function for quick usage
def rerank_documents(query: str, documents: List[str], top_k: int = 10) -> List[str]:
    """Quick reranking function for simple use cases."""
    reranker = get_reranker()
    result = reranker.multi_stage_reranking(query, documents, top_k=top_k)
    return result.documents
