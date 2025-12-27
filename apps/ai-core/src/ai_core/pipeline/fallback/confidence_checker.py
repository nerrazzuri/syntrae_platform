from typing import Dict, Any


class ConfidenceChecker:
    def low(self, payload: Dict[str, Any], threshold: float = 0.6) -> bool:
        try:
            # Prefer QC confidence if present
            qc = payload.get("qc_status") or {}
            conf = qc.get("confidence")
            if conf is None:
                conf = payload.get("confidence", 0.0)
            return float(conf) < float(threshold)
        except Exception:
            return True
