from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

class BaseConnector(ABC):
    @abstractmethod
    def send_reply(self, message: str, comment_id: str, video_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    def send_dm(self, message: str, author_id: str) -> Dict[str, Any]:
        pass

class MockConnector(BaseConnector):
    def __init__(self):
        self.sent_messages = []
        self.fail_next = False
        self.rate_limit_next = False

    def send_reply(self, message: str, comment_id: str, video_id: str) -> Dict[str, Any]:
        if self.fail_next:
            self.fail_next = False
            raise Exception("Mock Network Error")
        
        if self.rate_limit_next:
            self.rate_limit_next = False
            raise Exception("429 Too Many Requests")

        msg_id = f"mock_reply_{len(self.sent_messages)}"
        self.sent_messages.append({"type": "reply", "id": msg_id, "text": message})
        return {"id": msg_id, "status": "sent"}

    def send_dm(self, message: str, author_id: str) -> Dict[str, Any]:
        if self.fail_next:
            self.fail_next = False
            raise Exception("Mock Network Error")
            
        msg_id = f"mock_dm_{len(self.sent_messages)}"
        self.sent_messages.append({"type": "dm", "id": msg_id, "text": message})
        return {"id": msg_id, "status": "sent"}
