import argparse
import json
import itertools
from typing import List, Dict, Any
from dataclasses import replace
import sys
import os

# Add src to path
sys.path.append("src")

from ai_core.pipeline.rag_pipeline import RAGPipeline
import shared.config.tuning as tuning_module

def run_auto_tuner(tenant_id: str, dataset_path: str, output_path: str):
    """
    Run grid search to find best RAG parameters.
    """
    # Define search space
    search_space = {
        "top_k": [3, 5, 10]
    }
    
    keys = search_space.keys()
    values = search_space.values()
    combinations = [dict(zip(keys, v)) for v in itertools.product(*values)]
    
    best_score = -1.0
    best_config = None
    results = []
    
    print(f"Starting Auto-Tuner for tenant {tenant_id} with {len(combinations)} configurations...")
    
    # Load dataset
    with open(dataset_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    cases = data if isinstance(data, list) else data.get("cases", [])
    
    # Instantiate pipeline once (heavy loading)
    print("Initializing RAG Pipeline...")
    pipe = RAGPipeline()
    print("Pipeline initialized.")

    for config in combinations:
        print(f"Testing config: {config}")
        
        # Patch global config
        original_retrieval = tuning_module.retrieval
        try:
            # Create new config with overrides
            overrides = {}
            if "top_k" in config:
                overrides["vector_top_k"] = config["top_k"]
                # Also update hybrid_top_k to be slightly larger than vector_top_k
                overrides["hybrid_top_k"] = config["top_k"] + 4
            
            new_config = replace(original_retrieval, **overrides)
            tuning_module.retrieval = new_config
            
            tp = fp = fn = 0
            
            for case in cases:
                q = case.get("query", "")
                expected = str(case.get("answer", "")).strip().lower()
                
                # Run pipeline
                out = pipe.answer(q, tenant_id=tenant_id)
                
                pred = str(out.get("response", "")).strip().lower()
                
                # Simple exact match logic
                # In real world, use LLM evaluator or more complex metrics
                if expected and pred == expected:
                    tp += 1
                else:
                    if expected:
                        fn += 1
                    if pred:
                        fp += 1
            
            # Calculate F1
            p = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            r = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = (2 * p * r) / (p + r) if (p + r) > 0 else 0.0
            
            print(f"Config {config} -> F1: {f1:.4f}")
            
            results.append({
                "config": config,
                "metrics": {"precision": p, "recall": r, "f1": f1}
            })
            
            if f1 > best_score:
                best_score = f1
                best_config = config
                
        finally:
            # Restore original config
            tuning_module.retrieval = original_retrieval
            
    print(f"Best Config: {best_config} with F1: {best_score:.4f}")
    
    # Save results
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "best_config": best_config,
            "best_score": best_score,
            "all_results": results
        }, f, indent=2)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Auto-Tuner for RAG")
    parser.add_argument("--tenant", required=True, help="Tenant ID")
    parser.add_argument("--dataset", required=True, help="Path to Golden Dataset")
    parser.add_argument("--output", required=True, help="Output path for tuning results")
    
    args = parser.parse_args()
    run_auto_tuner(args.tenant, args.dataset, args.output)
