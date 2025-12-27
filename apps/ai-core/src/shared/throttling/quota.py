from __future__ import annotations

from typing import Optional

from shared.cache.redis import redis_cache
from shared.config.tuning import throttle as throttle_cfg


class Throttle:
    def _tenant_key(self, tenant_id: str, kind: str) -> str:
        return f"throttle:{kind}:{tenant_id}:concurrent"

    def _cap_for(self, tenant_tier: Optional[str], kind: str) -> int:
        tier = (tenant_tier or "").upper() or "BASIC"
        if kind == "llm":
            return int(
                throttle_cfg.tier_llm_caps.get(
                    tier, throttle_cfg.llm_concurrency_default
                )
            )
        return int(
            throttle_cfg.tier_embed_caps.get(
                tier, throttle_cfg.embed_concurrency_default
            )
        )

    def acquire(self, tenant_id: str, kind: str, tenant_tier: Optional[str]) -> bool:
        cli = redis_cache.get_client()
        if not cli:
            return True  # no redis -> no throttle
        key = self._tenant_key(tenant_id, kind)
        cap = self._cap_for(tenant_tier, kind)
        try:
            val = cli.incr(key)
            cli.expire(key, 30)
            if val > cap:
                # over cap -> rollback and deny
                cli.decr(key)
                return False
            return True
        except Exception:
            return True

    def release(self, tenant_id: str, kind: str) -> None:
        cli = redis_cache.get_client()
        if not cli:
            return
        key = self._tenant_key(tenant_id, kind)
        try:
            cli.decr(key)
        except Exception:
            pass


throttle = Throttle()
