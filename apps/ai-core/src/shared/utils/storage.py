"""
Utilities for writing document metadata to disk.
"""
import os
import json
from typing import Dict, Any


def write_metadata(
    base_path: str, tenant_id: str, document_id: str, metadata: Dict[str, Any]
) -> str:
    """Write metadata.json for a given document and return the file path.

    The file will be written to:
      {base_path}/tenant_{tenant_id}/documents/{document_id}/metadata.json
    """
    dir_path = os.path.join(
        base_path, f"tenant_{tenant_id}", "documents", str(document_id)
    )
    os.makedirs(dir_path, exist_ok=True)
    file_path = os.path.join(dir_path, "metadata.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    return file_path
