"""
Channel adapter: normalize and map identifiers across channels.
"""
from typing import Dict, Any


class ChannelAdapter:
    def extract_identifier(self, channel: str, payload: Dict[str, Any]) -> str:
        c = channel.lower()
        if c == "whatsapp":
            entry = payload.get("entry", [{}])[0]
            changes = entry.get("changes", [{}])[0]
            value = changes.get("value", {})
            messages = value.get("messages", [{}])
            msg = messages[0] if messages else {}
            return msg.get("from", "")
        if c == "teams":
            return payload.get("from", {}).get("id", "")
        if c == "telegram":
            return str(payload.get("message", {}).get("from", {}).get("id", ""))
        return ""
