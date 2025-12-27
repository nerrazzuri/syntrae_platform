from typing import Optional
import logging

from .core.schemas import InputData, DetectionResult, SignalTrace, ModelConfig, EmbeddingsBundle, EmbeddingConfig
# Removed direct import of VideoEmbeddingService, now using Orchestrator
from .embeddings.orchestrator import EmbeddingOrchestrator

# Heuristics
from .modules.commercial_gate import HeuristicCommercialGate
from .modules.niche_classifier import HeuristicNicheClassifier
from .modules.content_type_classifier import HeuristicContentTypeClassifier
from .modules.confidence_scorer import ConfidenceScorer

# Real Models
from .modules.sklearn_classifier import (
    SklearnCommercialGate, 
    SklearnNicheClassifier, 
    SklearnContentTypeClassifier
)

logger = logging.getLogger(__name__)

class VideoDetectionEngine:
    def __init__(self, config: Optional[ModelConfig] = None):
        if config is None:
            config = ModelConfig()
            
        self.config = config
        
        # 1. Initialize Embedding Orchestrator (Phase 3 Core)
        # Map ModelConfig to EmbeddingConfig
        self.embedding_config = EmbeddingConfig(
            model_name=config.embedding_model_name,
            fail_fast=False # Engine might want to survive partial failures or let orchestrator handle it
        )
        self.embedding_orchestrator = EmbeddingOrchestrator(config=self.embedding_config)
        
        # Legacy support: some classifiers might need the raw service
        # orchestrator.service is the underlying VideoEmbeddingService instance
        embedding_service = self.embedding_orchestrator.service
        
        # 2. Initialize Commercial Gate
        if config.commercial_classifier_path:
            logger.info("Using Sklearn Commercial Gate")
            self.commercial_gate = SklearnCommercialGate(
                config.commercial_classifier_path, 
                embedding_service
            )
        else:
            logger.info("Using Heuristic Commercial Gate")
            self.commercial_gate = HeuristicCommercialGate()

        # 3. Initialize Niche Classifier
        if config.niche_classifier_path:
            logger.info("Using Sklearn Niche Classifier")
            self.niche_classifier = SklearnNicheClassifier(
                config.niche_classifier_path, 
                embedding_service
            )
        else:
            logger.info("Using Heuristic Niche Classifier")
            self.niche_classifier = HeuristicNicheClassifier()
            
        # 4. Initialize Content Type Classifier
        if config.content_type_classifier_path:
            logger.info("Using Sklearn Content Type Classifier")
            self.content_type_classifier = SklearnContentTypeClassifier(
                config.content_type_classifier_path, 
                embedding_service
            )
        else:
            logger.info("Using Heuristic Content Type Classifier")
            self.content_type_classifier = HeuristicContentTypeClassifier()

        # 5. Scorer (Always the same logic for now)
        self.confidence_scorer = ConfidenceScorer()

    def process(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> DetectionResult:
        # Phase 3: Ensure EmbeddingsBundle exists
        if bundle is None:
            # Generate on the fly
            bundle = self.embedding_orchestrator.process(data)

        # Step 1: Commercial Gate
        is_comm, comm_conf, comm_signals = self.commercial_gate.assess(data, bundle)
        
        # Governance: Force Configured Thresholds
        # P3-06A/B: High confidence allows classification; Gray zone -> Safe.
        if comm_conf < self.config.commercial_threshold_high:
            is_comm = False
            
        # Prepare signal aggregator
        all_signals = SignalTrace()
        self._merge_signals(all_signals, comm_signals)

        if not is_comm:
            # Early Exit / Safe Fallback
            # P3-03B/P3-05B: Non-commercial forces other.consumer / unknown
            return DetectionResult(
                is_commercial_content=False,
                commercial_confidence=comm_conf,
                niche="other.consumer",
                sub_niche="unknown",
                content_type="unknown",
                confidence=comm_conf, 
                signals_used=all_signals
            )

        # Step 2: Niche
        niche, sub_niche, niche_conf, niche_signals = self.niche_classifier.classify(data, bundle)
        self._merge_signals(all_signals, niche_signals)

        # Governance: Sub-Niche Sanitization (P3-04A)
        # Max length 32, safe chars only
        import re
        if sub_niche and sub_niche != "unknown":
            # Keep alphanumeric, dot, underscore, hyphen
            sanitized = re.sub(r"[^a-zA-Z0-9_\-\.]", "", sub_niche)
            sub_niche = sanitized[:32]
            if not sub_niche: sub_niche = "unknown"

        # Step 3: Content Type
        c_type, c_type_conf, c_type_signals = self.content_type_classifier.classify(data, bundle)
        self._merge_signals(all_signals, c_type_signals)

        # Step 4: Aggregate Confidence
        final_conf = self.confidence_scorer.aggregate(comm_conf, niche_conf, c_type_conf)

        return DetectionResult(
            is_commercial_content=True,
            commercial_confidence=comm_conf,
            niche=niche,
            sub_niche=sub_niche,
            content_type=c_type,
            confidence=final_conf,
            signals_used=all_signals
        )

    def _merge_signals(self, trace: SignalTrace, new_signals: dict):
        """Helper to merge distinct signals."""
        for s in new_signals.get("visual", []):
            if s not in trace.visual:
                trace.visual.append(s)
        for s in new_signals.get("audio", []):
            if s not in trace.audio:
                trace.audio.append(s)
        for s in new_signals.get("text_overlay", []):
            if s not in trace.text_overlay:
                trace.text_overlay.append(s)
