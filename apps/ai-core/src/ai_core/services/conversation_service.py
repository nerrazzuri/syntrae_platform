"""
Conversation context management backed by SQLAlchemy models.
"""
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import select
from shared.database.models import Conversation, Message, User
import uuid


class ConversationService:
    def __init__(self, db: Session):
        self.db = db

    def get_or_create_conversation(
        self,
        tenant_id: str,
        user_id: str,
        channel: str,
        context: Optional[Dict[str, Any]] = None,
        channel_ctx: Optional[Dict[str, Any]] = None,
    ) -> Conversation:
        # Ensure the user exists to satisfy FK constraints (PostgreSQL)
        user = self.db.get(User, user_id)
        if not user:
            # Default new users to END_USER role; infer type from channel
            inferred_type = (
                "EXTERNAL_CUSTOMER"
                if channel.lower() in {"web", "whatsapp", "telegram", "teams"}
                else "EXTERNAL_CUSTOMER"
            )
            user = User(id=user_id, tenant_id=tenant_id, user_type=inferred_type)
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)

        stmt = (
            select(Conversation)
            .where(Conversation.tenant_id == tenant_id)
            .where(Conversation.user_id == user_id)
            .where(Conversation.channel == channel)
            .where(Conversation.status == "ACTIVE")
        )
        existing = self.db.execute(stmt).scalars().first()
        if existing:
            # If conversation has no messages yet, seed Omni greeting
            try:
                from sqlalchemy import func

                count = (
                    self.db.execute(
                        select(func.count())
                        .select_from(Message)
                        .where(Message.conversation_id == existing.id)
                    ).scalar()
                    or 0
                )
                if count == 0:
                    greeting = "Hello! I’m Omni. How can I help you today?"
                    self.add_message(existing, sender_type="SYSTEM", content=greeting)
            except Exception:
                pass
            return existing

        convo = Conversation(
            tenant_id=tenant_id,
            user_id=user_id,
            channel=channel,
            context=context or {},
            channel_context=channel_ctx or {},
        )
        self.db.add(convo)
        self.db.commit()
        self.db.refresh(convo)
        # Initial greeting from Omni
        try:
            greeting = "Hello! I’m Omni. How can I help you today?"
            self.add_message(convo, sender_type="SYSTEM", content=greeting)
        except Exception:
            pass
        return convo

    def add_message(
        self,
        conversation: Conversation,
        sender_type: str,
        content: str,
        message_type: str = "TEXT",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Message:
        msg = Message(
            conversation_id=conversation.id,
            sender_type=sender_type,
            content=content,
            message_type=message_type,
            meta=metadata or {},
        )
        self.db.add(msg)
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def get_recent_messages(
        self, conversation: Conversation, limit: int = 10
    ) -> List[Message]:
        stmt = (
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.timestamp.desc())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().all())

    def get_active_conversation(
        self, tenant_id: str, user_id: str, channel: str = "web"
    ) -> Optional[Conversation]:
        stmt = (
            select(Conversation)
            .where(Conversation.tenant_id == tenant_id)
            .where(Conversation.user_id == user_id)
            .where(Conversation.channel == channel)
            .where(Conversation.status == "ACTIVE")
        )
        return self.db.execute(stmt).scalars().first()

    def get_recent_messages_by_ids(
        self, tenant_id: str, user_id: str, limit: int = 5
    ) -> List[Dict[str, Any]]:
        # Guard invalid UUIDs to avoid DB binding errors
        try:
            _ = uuid.UUID(str(tenant_id))
            _ = uuid.UUID(str(user_id))
        except Exception:
            return []
        convo = self.get_active_conversation(tenant_id, user_id)  # default channel
        if not convo:
            return []
        msgs = self.get_recent_messages(convo, limit=limit)
        out: List[Dict[str, Any]] = []
        for m in msgs:
            try:
                out.append({"content": m.content, "meta": (m.meta or {})})
            except Exception:
                out.append({"content": m.content, "meta": {}})
        return out
