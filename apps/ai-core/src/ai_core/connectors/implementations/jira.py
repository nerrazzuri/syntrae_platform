from __future__ import annotations

from typing import List, Dict, Any
import requests
from ai_core.connectors.auth import get_oauth2_token, get_api_key


def fetch_issues(base_url: str, project_key: str, token: str) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    url = f"{base_url}/rest/api/3/search?jql=project={project_key}"
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        data = resp.json() or {}
        return data.get("issues", [])
    except Exception:
        return []


def transform_issues(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for it in issues:
        fields = it.get("fields", {})
        summary = fields.get("summary", "")
        desc = (fields.get("description", {}) or {})
        if isinstance(desc, dict) and desc.get("content"):
            try:
                # Simplify Atlassian doc format into text
                blocks = []
                for c in desc.get("content"):
                    for p in c.get("content", []) or []:
                        t = p.get("text")
                        if t:
                            blocks.append(t)
                description = "\n".join(blocks)
            except Exception:
                description = ""
        else:
            description = str(desc) if desc else ""
        text = f"Summary: {summary}\nDescription: {description}".strip()
        if text:
            out.append({"text": text[:4000], "meta": {"key": it.get("key")}})
    return out


