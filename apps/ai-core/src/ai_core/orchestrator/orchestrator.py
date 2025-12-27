import asyncio
from typing import Any, Dict
import logging
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.orchestrator.flow_registry import select_flow
from ai_core.capabilities.base import Capability
from ai_core.registry import CapabilityRegistry


class Orchestrator:
    def __init__(
        self, capabilities: Dict[str, Any], registry: CapabilityRegistry | None = None
    ):
        self.capabilities = capabilities
        self.registry = registry or CapabilityRegistry()

    async def run(self, request: CapabilityRequest) -> CapabilityResponse:
        # Pre-governance (input sanitization, policy pre-checks)
        gov = self.capabilities.get("govern")
        effective_request = request
        pre_policy = {}
        if gov is not None:
            try:
                pre = await gov.execute(
                    request.model_copy(
                        update={"input": {"text": request.input.get("query", "")}}
                    )
                )
                if isinstance(pre.payload, dict) and "text" in pre.payload:
                    effective_request = request.model_copy(
                        update={
                            "input": {**request.input, "query": pre.payload["text"]}
                        }
                    )
                pre_policy = pre.policy_decisions or {}
            except Exception:
                # Fail-open on pre-govern; downstream may still enforce
                pre_policy = {"govern_pre_failed": True}
        # Wrap capabilities with validation layer for this request
        flow = select_flow(effective_request)
        flow_name = getattr(flow, "__name__", "unknown_flow")
        validated_caps: Dict[str, Any] = {}
        for name, cap in self.capabilities.items():
            if isinstance(cap, Capability):
                validated_caps[name] = _ValidatedCapability(
                    name=name, inner=cap, registry=self.registry, flow_name=flow_name
                )
            else:
                validated_caps[name] = cap
        result = await flow(validated_caps, effective_request)
        # Post-governance (output redaction/policy)
        post_policy = {}
        if gov is not None:
            try:
                out_text = None
                if isinstance(result.payload, dict):
                    out_text = result.payload.get("response")
                else:
                    out_text = str(result.payload)
                post = await gov.execute(
                    effective_request.model_copy(
                        update={"input": {"text": out_text or ""}}
                    )
                )
                # If redacted, update response text
                if isinstance(result.payload, dict) and isinstance(post.payload, dict):
                    if (
                        "text" in post.payload
                        and result.payload.get("response") is not None
                    ):
                        result.payload["response"] = post.payload["text"]
                post_policy = post.policy_decisions or {}
            except Exception:
                post_policy = {"govern_post_failed": True}
        merged_policy = {**pre_policy, **(result.policy_decisions or {}), **post_policy}
        result.policy_decisions = merged_policy or None
        return result


class _ValidatedCapability(Capability):
    """Proxy that validates capability execution via registry before delegating."""

    def __init__(
        self, name: str, inner: Capability, registry: CapabilityRegistry, flow_name: str
    ) -> None:
        self._name = name
        self._inner = inner
        self._registry = registry
        self._flow = flow_name
        self._log = logging.getLogger(__name__)

    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        spec = self._registry.get(self._name)
        if spec is None:
            self._log.error(
                "capability_spec_missing",
                extra={
                    "capability": self._name,
                    "tenant_id": request.tenant_id,
                    "trace_id": request.trace_id,
                    "flow": self._flow,
                },
            )
            return CapabilityResponse(
                kind="error",
                payload={"error": "capability_spec_missing", "capability": self._name},
                policy_decisions={"denied": "spec_missing", "capability": self._name},
            )
        vr = self._registry.validate(spec, request)
        if not vr.allowed:
            self._log.info(
                "capability_denied",
                extra={
                    "capability": self._name,
                    "tenant_id": request.tenant_id,
                    "trace_id": request.trace_id,
                    "flow": self._flow,
                    "reason": vr.reason,
                },
            )
            return CapabilityResponse(
                kind="error",
                payload={"error": "capability_denied", "capability": self._name},
                policy_decisions={
                    "denied": True,
                    "capability": self._name,
                    "reason": vr.reason,
                },
                telemetry={"denied": True},
            )
        return await self._inner.execute(request)
