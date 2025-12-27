import sys
import os
sys.path.append("src")

try:
    from ai_core.pipeline.rag_pipeline import RAGPipeline
    print("Import successful")
    pipe = RAGPipeline()
    print("Instantiation successful")
except Exception as e:
    import traceback
    traceback.print_exc()
