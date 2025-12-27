from typing import Dict, Any, Optional, List, Tuple

import logging
import re


class StructuredExecutor:
    """Natural-language executor over tabular data for aggregate intent.

    Public API:
      execute(query, dataframe, schema_info, context) -> Optional[Dict[str, Any]]
    """

    def __init__(self) -> None:
        self.log = logging.getLogger(__name__)
        self._duck = None
        try:
            import duckdb as _duckdb  # type: ignore

            self._duck = _duckdb
        except Exception:
            self._duck = None
        # Simple per-process caches
        self._tenant_conn: Dict[str, Any] = {}
        self._tenant_conn_ts: Dict[str, float] = {}
        self._syn_cache: Dict[str, Dict[str, List[float]]] = {}
        self._col_list: Dict[str, List[str]] = {}
        try:
            from shared.metrics.retrieval_metrics import retrieval_metrics

            self._ret_metrics = retrieval_metrics
        except Exception:
            self._ret_metrics = None

    # ------------------------------
    # Public API
    # ------------------------------
    def execute(
        self,
        query: str,
        dataframe,
        schema_info: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        try:
            parsed = self._parse_nl(query)
            if not parsed:
                return None
            # Expand synonyms using schema-aware generation
            synmap = self._get_or_build_synonyms(schema_info, context)
            # Build SQL (or pandas fallback)
            if self._duck is not None:
                result = self._run_duckdb(
                    dataframe, parsed, schema_info, synmap, context
                )
            else:
                result = self._run_pandas(
                    dataframe, parsed, schema_info, synmap, context
                )
            return result
        except Exception as e:
            self.log.exception(
                "[structured.execute] failed", extra={"module_name": __name__}
            )
            return None

    # ------------------------------
    # Parsing
    # ------------------------------
    def _parse_nl(self, q: str) -> Optional[Dict[str, Any]]:
        ql = (q or "").strip().lower()
        if not ql:
            return None
        # Detect operation
        op = None
        if re.search(r"\bhow\s+many\b|\bcount\b|\bnumber\s+of\b", ql):
            op = "count"
        elif re.search(r"\baverage\b|\bavg\b|\bmean\b", ql):
            op = "avg"
        elif re.search(r"\bsum\b|\btotal\b", ql):
            op = "sum"
        elif re.search(r"\bminimum\b|\bmin\b|\blowest\b", ql):
            op = "min"
        elif re.search(r"\bmaximum\b|\bmax\b|\bhighest\b", ql):
            op = "max"
        elif re.search(r"\bmedian\b", ql):
            op = "median"
        else:
            op = "count"

        # Group by
        g = None
        m = re.search(r"\bby\s+([a-z0-9_\s]+)$", ql)
        if m:
            g = m.group(1).strip()

        # Filters (very lightweight): phrases after where/for/with/in/by (excluding group-by trailing)
        filters: Dict[str, str] = {}
        # Split by common filter prepositions
        parts = re.split(r"\bwhere\b|\bfor\b|\bwith\b|\bin\b|\bby\b", ql)
        if len(parts) > 1:
            tail = parts[-1]
            # Token pairs: Department Finance, manager john, title engineer
            toks = re.findall(r"[a-zA-Z0-9_]+", tail)
            # Make naive pairs
            for i in range(0, len(toks) - 1, 2):
                k = toks[i].strip().lower()
                v = toks[i + 1].strip()
                if k and v:
                    filters[k] = v

        return {"operation": op, "groupby": g, "filters": filters}

    # ------------------------------
    # Synonyms (local)
    # ------------------------------
    def _get_or_build_synonyms(
        self, schema_info: Dict[str, Any], context: Dict[str, Any]
    ) -> Dict[str, List[float]]:
        tenant = str(context.get("tenant_id", "default"))
        if tenant in self._syn_cache:
            return self._syn_cache[tenant]
        cols: List[str] = [str(c).strip() for c in (schema_info.get("columns") or [])]
        self._col_list[tenant] = cols
        # Build embedding vectors per column using retrieval embedding model
        try:
            from ai_core.pipeline.embedding.embedding_service import EmbeddingService

            emb = EmbeddingService()
            vecs = emb._embed_with_cache(cols, tenant)  # type: ignore[arg-type]
        except Exception as e:
            self.log.exception(
                "[structured.synonyms] embed error", extra={"tenant_id": tenant}
            )
            vecs = [[0.0] * 16 for _ in cols]
        syns: Dict[str, List[float]] = {}
        for c, v in zip(cols, vecs):
            syns[c.lower()] = list(v or [])
        self._syn_cache[tenant] = syns
        return syns

    # ------------------------------
    # Type reasoning
    # ------------------------------
    def _eligible(self, schema_info: Dict[str, Any], col: str, op: str) -> bool:
        types = (schema_info.get("types") or {}).get(col)
        if not types:
            return True
        t = str(types).lower()
        if op in ("sum", "avg", "min", "max", "median"):
            return ("int" in t) or ("float" in t) or ("decimal" in t) or ("number" in t)
        return True

    # ------------------------------
    # Execution backends
    # ------------------------------
    def _resolve_col(
        self, name: str, schema_info: Dict[str, Any], synmap: Dict[str, List[float]]
    ) -> Optional[str]:
        cand = name.strip().lower()
        cols: List[str] = [str(c).lower() for c in (schema_info.get("columns") or [])]
        if cand in cols:
            return cand
        # Embed candidate token and compute cosine similarity to each column vector
        try:
            from ai_core.pipeline.embedding.embedding_service import EmbeddingService

            emb = EmbeddingService()
            vq = emb.embed_query(cand, "default")  # tenant-independent semantic mapping
        except Exception:
            vq = None
        best = None
        best_sim = -1.0

        def cos(a: List[float], b: List[float]) -> float:
            if not a or not b:
                return -1.0
            import math

            num = sum(x * y for x, y in zip(a, b))
            da = math.sqrt(sum(x * x for x in a)) or 1.0
            db = math.sqrt(sum(y * y for y in b)) or 1.0
            return num / (da * db)

        if vq:
            for col, vec in synmap.items():
                s = cos(vq, vec)
                if s > best_sim:
                    best_sim = s
                    best = col
        if best and best_sim >= 0.8:
            return best
        # substring fallback
        for col in cols:
            if cand in col:
                return col
        return None

    def _build_where(
        self,
        parsed: Dict[str, Any],
        schema_info: Dict[str, Any],
        synmap: Dict[str, List[str]],
    ) -> Tuple[str, Dict[str, Any]]:
        filters = parsed.get("filters") or {}
        clauses: List[str] = []
        params: Dict[str, Any] = {}
        idx = 0
        for k, v in filters.items():
            col = self._resolve_col(k, schema_info, synmap)
            if not col:
                continue
            p = f"p{idx}"
            clauses.append(f"lower({col}) LIKE '%'||lower(:{p})||'%'")
            params[p] = v
            idx += 1
        where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        return where_sql, params

    def _run_duckdb(
        self,
        df,
        parsed: Dict[str, Any],
        schema_info: Dict[str, Any],
        synmap: Dict[str, List[str]],
        context: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        tenant = str(context.get("tenant_id", "default"))
        # Aging policy for per-tenant connections
        import time
        from shared.config.tuning import retrieval as retr_cfg

        # Close stale connections
        try:
            ttl = int(getattr(retr_cfg, "duckdb_conn_ttl_s", 900))
            max_conns = int(getattr(retr_cfg, "duckdb_max_conns", 16))
        except Exception:
            ttl = 900
            max_conns = 16
        now = time.time()
        for t_id, ts in list(self._tenant_conn_ts.items()):
            if (now - float(ts)) > ttl:
                try:
                    c = self._tenant_conn.get(t_id)
                    if c:
                        c.close()
                except Exception:
                    pass
                finally:
                    self._tenant_conn.pop(t_id, None)
                    self._tenant_conn_ts.pop(t_id, None)
        # Enforce max pool size by evicting oldest
        if len(self._tenant_conn) >= max_conns and tenant not in self._tenant_conn:
            try:
                oldest_t = sorted(self._tenant_conn_ts.items(), key=lambda x: x[1])[0][
                    0
                ]
                oc = self._tenant_conn.get(oldest_t)
                if oc:
                    oc.close()
            except Exception:
                pass
            finally:
                self._tenant_conn.pop(oldest_t, None)
                self._tenant_conn_ts.pop(oldest_t, None)
        conn = self._tenant_conn.get(tenant)
        if conn is None:
            conn = self._duck.connect()
            self._tenant_conn[tenant] = conn
        self._tenant_conn_ts[tenant] = now
        try:
            if self._ret_metrics:
                self._ret_metrics.set_duckdb_active(tenant, len(self._tenant_conn))
        except Exception:
            pass
        conn.register("t", df)
        op = parsed["operation"]
        where_sql, params = self._build_where(parsed, schema_info, synmap)

        sql = None
        if op == "count":
            sql = f"SELECT COUNT(*) AS value FROM t {where_sql}"
        elif op in ("sum", "avg", "min", "max", "median"):
            # Try to find a target numeric column from filters or tokens (fallback to first numeric)
            target = None
            for tok in re.findall(r"[a-zA-Z_]+", context.get("query", "")):
                cand = self._resolve_col(tok, schema_info, synmap)
                if cand and self._eligible(schema_info, cand, op):
                    target = cand
                    break
            if not target:
                # find first eligible numeric column
                for c in schema_info.get("columns") or []:
                    if self._eligible(schema_info, str(c).lower(), op):
                        target = str(c).lower()
                        break
            if not target:
                return None
            func = (
                "avg"
                if op == "avg"
                else (
                    "sum"
                    if op == "sum"
                    else (
                        "min" if op == "min" else ("max" if op == "max" else "median")
                    )
                )
            )
            sql = f"SELECT {func}({target}) AS value FROM t {where_sql}"
        else:
            # group by if specified
            g = parsed.get("groupby")
            if g:
                col = self._resolve_col(g, schema_info, synmap)
                if col:
                    sql = f"SELECT {col} AS key, COUNT(*) AS value FROM t {where_sql} GROUP BY {col} ORDER BY value DESC"

        if not sql:
            # Default group by if asked explicitly
            g = parsed.get("groupby")
            if g:
                col = self._resolve_col(g, schema_info, synmap)
                if col:
                    sql = f"SELECT {col} AS key, COUNT(*) AS value FROM t {where_sql} GROUP BY {col} ORDER BY value DESC"
        if not sql:
            return None

        res = conn.execute(sql, params).fetchall()
        if not res:
            return None
        # Format
        if isinstance(res[0], tuple) and len(res[0]) == 1:
            val = res[0][0]
            summary = self._summarize(parsed, val)
            self.log.info(
                f"executor: agg={parsed['operation']} filters={parsed.get('filters')} result={val}"
            )
            return {
                "intent": "aggregate",
                "query_type": parsed["operation"],
                "filters": parsed.get("filters"),
                "result": val,
                "summary": summary,
            }
        else:
            # table output (group by)
            rows = [{"key": r[0], "value": r[1]} for r in res]
            summary = ", ".join([f"{r['key']} {r['value']}" for r in rows[:6]])
            self.log.info(
                f"executor: agg=group filters={parsed.get('filters')} result_rows={len(rows)}"
            )
            return {
                "intent": "aggregate",
                "query_type": "groupby",
                "filters": parsed.get("filters"),
                "result": rows,
                "summary": summary,
            }

    def _run_pandas(
        self,
        df,
        parsed: Dict[str, Any],
        schema_info: Dict[str, Any],
        synmap: Dict[str, List[str]],
        context: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        # Very lightweight fallback using pandas ops
        try:
            import pandas as _pd  # type: ignore
        except Exception:
            return None
        op = parsed["operation"]
        # Apply simple filters
        fdf = df.copy()
        for k, v in (parsed.get("filters") or {}).items():
            col = self._resolve_col(k, schema_info, synmap)
            if not col or col not in fdf.columns:
                continue
            fdf = fdf[fdf[col].astype(str).str.contains(str(v), case=False, na=False)]

        if op == "count":
            val = int(len(fdf))
            return {
                "intent": "aggregate",
                "query_type": "count",
                "filters": parsed.get("filters"),
                "result": val,
                "summary": self._summarize(parsed, val),
            }
        elif op in ("sum", "avg", "min", "max", "median"):
            target = None
            for c in fdf.columns:
                if self._eligible(schema_info, str(c).lower(), op):
                    target = c
                    break
            if not target:
                return None
            s = _pd.to_numeric(
                fdf[target].astype(str).str.replace(",", "").str.replace("$", ""),
                errors="coerce",
            )
            if op == "sum":
                val = float(s.sum())
            elif op == "avg":
                val = float(s.mean())
            elif op == "min":
                val = float(s.min())
            elif op == "max":
                val = float(s.max())
            else:
                val = float(s.median())
            return {
                "intent": "aggregate",
                "query_type": op,
                "filters": parsed.get("filters"),
                "result": val,
                "summary": self._summarize(parsed, val),
            }

        g = parsed.get("groupby")
        if g:
            col = self._resolve_col(g, schema_info, synmap)
            if col and col in fdf.columns:
                vc = fdf[col].astype(str).str.strip().value_counts()
                rows = [{"key": k, "value": int(v)} for k, v in vc.items()]
                summary = ", ".join([f"{r['key']} {r['value']}" for r in rows[:6]])
                return {
                    "intent": "aggregate",
                    "query_type": "groupby",
                    "filters": parsed.get("filters"),
                    "result": rows,
                    "summary": summary,
                }
        return None

    def _summarize(self, parsed: Dict[str, Any], value: Any) -> str:
        op = parsed.get("operation")
        if op == "count":
            return f"There are {int(value)} records."
        if op == "avg":
            try:
                return f"Average is {float(value):,.0f}."
            except Exception:
                return f"Average is {value}."
        if op == "sum":
            try:
                return f"Sum is {float(value):,.0f}."
            except Exception:
                return f"Sum is {value}."
        if op in ("min", "max", "median"):
            return f"{op.title()} is {value}."
        return str(value)
