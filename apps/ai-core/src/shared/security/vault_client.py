from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import os
from typing import Dict, Optional
from urllib import request as _req, error as _err

from shared.config.tuning import vault as vault_cfg
from shared.metrics.vault_metrics import vault_metrics


_logger = logging.getLogger(__name__)


def _h(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


class VaultClient:
    """Minimal Vault KV v2 client with in-memory caching and background refresh.

    Expects VAULT_MOUNT_PATH like 'secret/data/ai_core'. Keys are fetched as
    mount_path + '/' + key (e.g., 'secret/data/ai_core/OPENAI_API_KEY').
    """

    def __init__(self) -> None:
        self.enabled = bool(
            vault_cfg.enabled
            and vault_cfg.addr
            and vault_cfg.token
            and vault_cfg.mount_path
        )
        self.addr = vault_cfg.addr.rstrip("/")
        self.token = vault_cfg.token
        self.mount_path = vault_cfg.mount_path.strip("/")
        self.cache_ttl = max(1, int(vault_cfg.cache_ttl_s))
        self.refresh_interval = max(1, int(vault_cfg.refresh_interval_s))
        self._cache: Dict[str, Dict[str, object]] = {}
        self._lock = threading.RLock()
        self._stop = False
        self._refresh_thread: Optional[threading.Thread] = None
        # Optional Kubernetes auth configuration
        self.k8s_role = (getattr(vault_cfg, "k8s_role", None) or
                         os.getenv("VAULT_K8S_ROLE") or "")
        self.k8s_mount = os.getenv("VAULT_K8S_MOUNT", "kubernetes").strip("/")
        self.k8s_sa_token_path = os.getenv(
            "VAULT_K8S_SA_TOKEN_PATH",
            "/var/run/secrets/kubernetes.io/serviceaccount/token",
        )
        # If VAULT_TOKEN not provided but k8s role is, try to login
        if vault_cfg.enabled and not self.token and self.k8s_role:
            try:
                self._k8s_login()
            except Exception as e:
                _logger.error("[vault.k8s_login] failed: %s", str(e))

    def start_refresh(self) -> None:
        if not self.enabled:
            return
        if self._refresh_thread and self._refresh_thread.is_alive():
            return
        self._refresh_thread = threading.Thread(target=self._refresh_loop, daemon=True)
        self._refresh_thread.start()

    def stop_refresh(self) -> None:
        self._stop = True

    def _refresh_loop(self) -> None:
        while not self._stop:
            time.sleep(self.refresh_interval)
            try:
                with self._lock:
                    keys = list(self._cache.keys())
                for key in keys:
                    try:
                        _ = self._fetch_remote(key, force=True)
                    except Exception as e:
                        _logger.warning(
                            "[vault.refresh] failed", extra={"key": key, "err": str(e)}
                        )
                # Best-effort token renew if we are using a renewable token
                try:
                    _ = self.renew_token()
                except Exception:
                    pass
            except Exception:
                pass

    def _k8s_login(self) -> None:
        """Login to Vault via Kubernetes auth and store client token."""
        if not self.k8s_role:
            return
        sa_jwt = ""
        try:
            with open(self.k8s_sa_token_path, "r", encoding="utf-8") as f:
                sa_jwt = f.read().strip()
        except Exception as e:
            raise RuntimeError(f"cannot read SA token: {e}")
        payload = json.dumps({"role": self.k8s_role, "jwt": sa_jwt}).encode("utf-8")
        url = f"{self.addr}/v1/auth/{self.k8s_mount}/login"
        req = _req.Request(url, headers={"Content-Type": "application/json"}, data=payload)
        with _req.urlopen(req, timeout=5) as resp:
            body = resp.read()
            obj = json.loads(body.decode("utf-8"))
            client_token = ((obj or {}).get("auth") or {}).get("client_token")
            if not client_token:
                raise RuntimeError("k8s login returned no client_token")
            with self._lock:
                self.token = client_token
            _logger.info("[vault.k8s_login] obtained client token")

    def load_all(self, prefix: str = "") -> Dict[str, str]:
        """Fetch all keys under mount_path/prefix; KVv2 returns a JSON dict."""
        if not self.enabled:
            return {}
        # For KVv2, reading a 'folder' returns data dict only if stored as a single doc
        # We assume secrets are stored as a single JSON under mount_path (e.g., secret/data/ai_core)
        path = self.mount_path
        if prefix:
            path = f"{path}/{prefix.strip('/')}"
        try:
            url = f"{self.addr}/v1/{path}"
            req = _req.Request(url, headers={"X-Vault-Token": self.token})
            with _req.urlopen(req, timeout=5) as resp:
                body = resp.read()
                obj = json.loads(body.decode("utf-8"))
                data = ((obj or {}).get("data") or {}).get("data") or {}
                if isinstance(data, dict):
                    for k, v in data.items():
                        if isinstance(v, str):
                            self._remember(k, v)
                    vault_metrics.inc_fetch_success()
                    return {k: str(v) for k, v in data.items() if isinstance(v, str)}
                vault_metrics.inc_fetch_failure("decode")
                return {}
        except _err.HTTPError as e:
            if e.code == 403 and self.k8s_role:
                try:
                    self._k8s_login()
                    return self.load_all(prefix=prefix)
                except Exception:
                    pass
            vault_metrics.inc_fetch_failure("http")
            _logger.error("[vault.load_all] http error %s", e.code)
            return {}
        except Exception as e:
            vault_metrics.inc_fetch_failure("other")
            _logger.error("[vault.load_all] error: %s", str(e))
            return {}

    def get_secret(self, key: str) -> Optional[str]:
        if not self.enabled:
            return None
        # cache
        with self._lock:
            ent = self._cache.get(key)
            if ent and (time.time() - float(ent.get("ts", 0))) < self.cache_ttl:
                vault_metrics.inc_cache_hit()
                return str(ent.get("val"))
        # remote fetch
        try:
            return self._fetch_remote(key)
        except Exception as e:
            vault_metrics.inc_fetch_failure("other")
            _logger.error("[vault.get_secret] error for key %s: %s", key, str(e))
            return None

    def _fetch_remote(self, key: str, force: bool = False) -> Optional[str]:
        path = f"{self.mount_path}/{key.strip('/')}"
        url = f"{self.addr}/v1/{path}"
        req = _req.Request(url, headers={"X-Vault-Token": self.token})
        with _req.urlopen(req, timeout=5) as resp:
            body = resp.read()
            obj = json.loads(body.decode("utf-8"))
            data = ((obj or {}).get("data") or {}).get("data") or {}
            val = data.get(key) if key in data else data.get("value")
            if val is None and isinstance(data, dict) and key in data:
                val = data[key]
            if isinstance(val, (str, int)):
                sval = str(val)
                prev_hash = None
                with self._lock:
                    old = self._cache.get(key)
                    if old:
                        prev_hash = str(old.get("hash"))
                self._remember(key, sval)
                if prev_hash and prev_hash != _h(sval):
                    vault_metrics.inc_rotation(_h(key))
                vault_metrics.inc_fetch_success()
                return sval
            vault_metrics.inc_fetch_failure("decode")
            return None

    def _remember(self, key: str, value: str) -> None:
        with self._lock:
            self._cache[key] = {"val": value, "hash": _h(value), "ts": time.time()}

    def put_all(self, prefix: str, data: Dict[str, str]) -> bool:
        """Write a dict of secrets to KV v2 under mount_path/prefix (server-side only)."""
        if not self.enabled:
            return False
        try:
            path = self.mount_path
            if prefix:
                path = f"{path}/{prefix.strip('/')}"
            url = f"{self.addr}/v1/{path}"
            payload = json.dumps({"data": data}).encode("utf-8")
            req = _req.Request(
                url,
                headers={"X-Vault-Token": self.token, "Content-Type": "application/json"},
                data=payload,
                method="POST",
            )
            with _req.urlopen(req, timeout=5) as resp:
                _ = resp.read()
            # Refresh cache entries for keys provided
            for k, v in (data or {}).items():
                if isinstance(v, str):
                    self._remember(k, v)
            return True
        except Exception as e:
            _logger.error("[vault.put_all] error: %s", str(e))
            return False

    # --- Token lifecycle helpers ---
    def lookup_token_ttl(self) -> Optional[int]:
        if not self.enabled:
            return None
        try:
            url = f"{self.addr}/v1/auth/token/lookup-self"
            req = _req.Request(url, headers={"X-Vault-Token": self.token}, method="GET")
            with _req.urlopen(req, timeout=5) as resp:
                body = resp.read()
                obj = json.loads(body.decode("utf-8"))
                ttl = int(((obj or {}).get("data") or {}).get("ttl", 0))
                return ttl
        except Exception as e:
            _logger.error("[vault.token.lookup] error: %s", str(e))
            return None

    def renew_token(self) -> bool:
        if not self.enabled:
            return False
        try:
            url = f"{self.addr}/v1/auth/token/renew-self"
            req = _req.Request(url, headers={"X-Vault-Token": self.token}, data=b"{}")
            with _req.urlopen(req, timeout=5) as resp:
                # success renew returns new token data (we keep same client token)
                _ = resp.read()
                return True
        except Exception as e:
            _logger.error("[vault.token.renew] error: %s", str(e))
            return False


# Global instance
vault_client = VaultClient()
