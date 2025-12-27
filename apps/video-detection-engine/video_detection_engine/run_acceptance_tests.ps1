$env:PYTHONPATH="."
python -m pytest tests/acceptance/test_phase1_ingest.py tests/acceptance/test_phase2_embeddings.py
