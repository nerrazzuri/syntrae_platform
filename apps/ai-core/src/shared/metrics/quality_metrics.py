from __future__ import annotations

try:
    from prometheus_client import Gauge, Counter  # type: ignore
except Exception:  # pragma: no cover
    Gauge = None  # type: ignore
    Counter = None  # type: ignore

from shared.config.tuning import telemetry


class QualityMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Gauge is not None:
            self.precision = Gauge(
                "ai_core_quality_precision", "Precision@k", ["tenant", "suite"]
            )
            self.recall = Gauge(
                "ai_core_quality_recall", "Recall@k", ["tenant", "suite"]
            )
            self.f1 = Gauge("ai_core_quality_f1", "F1 score", ["tenant", "suite"])
            self.reranker_acc = Gauge(
                "ai_core_reranker_accuracy", "Reranker accuracy", ["tenant"]
            )
            self.intent_conf_avg = Gauge(
                "ai_core_intent_confidence_avg", "Avg intent confidence", ["tenant"]
            )
            self.response_conf_avg = Gauge(
                "ai_core_quality_confidence_avg",
                "Avg response confidence (QC)",
                ["tenant"],
            )
        else:
            self.precision = None
            self.recall = None
            self.f1 = None
            self.reranker_acc = None
            self.intent_conf_avg = None
            self.response_conf_avg = None

    def set_eval(self, tenant: str, suite: str, p: float, r: float, f1: float) -> None:
        try:
            if self.precision:
                self.precision.labels(tenant=tenant, suite=suite).set(float(p))
            if self.recall:
                self.recall.labels(tenant=tenant, suite=suite).set(float(r))
            if self.f1:
                self.f1.labels(tenant=tenant, suite=suite).set(float(f1))
        except Exception:
            pass

    def set_reranker_acc(self, tenant: str, acc: float) -> None:
        try:
            if self.reranker_acc:
                self.reranker_acc.labels(tenant=tenant).set(float(acc))
        except Exception:
            pass

    def set_intent_conf(self, tenant: str, conf: float) -> None:
        try:
            if self.intent_conf_avg:
                self.intent_conf_avg.labels(tenant=tenant).set(float(conf))
        except Exception:
            pass

    def set_response_conf(self, tenant: str, conf: float) -> None:
        try:
            if self.response_conf_avg:
                self.response_conf_avg.labels(tenant=tenant).set(float(conf))
        except Exception:
            pass


quality_metrics = QualityMetrics()
