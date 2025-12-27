"""
Reranker-specific caching for performance optimization.
"""
import hashlib
from typing import Optional, List
from .redis import redis_cache


class RerankerCache:
    def __init__(self):
        self.default_ttl = 3600  # 1小时
        self.cross_encoder_ttl = 7200  # 2小时

    def _get_cache_key(self, query: str, docs: List[str]) -> str:
        """生成缓存键"""
        content = f"{query}:{'|'.join(docs[:5])}"  # 只用前5个文档生成键
        return hashlib.md5(content.encode()).hexdigest()

    def get_cross_encoder_scores(
        self, query: str, docs: List[str]
    ) -> Optional[List[float]]:
        """获取CrossEncoder缓存分数"""
        cache_key = f"rerank:cross:{self._get_cache_key(query, docs)}"
        return redis_cache.get_tenant_key("global", cache_key)

    def set_cross_encoder_scores(
        self, query: str, docs: List[str], scores: List[float]
    ):
        """缓存CrossEncoder分数"""
        cache_key = f"rerank:cross:{self._get_cache_key(query, docs)}"
        redis_cache.set_tenant_key("global", cache_key, scores, self.cross_encoder_ttl)

    def get_ltr_scores(self, query: str, docs: List[str]) -> Optional[List[float]]:
        """获取LTR缓存分数"""
        cache_key = f"rerank:ltr:{self._get_cache_key(query, docs)}"
        return redis_cache.get_tenant_key("global", cache_key)

    def set_ltr_scores(self, query: str, docs: List[str], scores: List[float]):
        """缓存LTR分数"""
        cache_key = f"rerank:ltr:{self._get_cache_key(query, docs)}"
        redis_cache.set_tenant_key("global", cache_key, scores, self.default_ttl)


reranker_cache = RerankerCache()
