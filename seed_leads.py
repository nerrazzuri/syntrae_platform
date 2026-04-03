
import sys
import os
from sqlalchemy.orm import Session
from sqlalchemy import create_engine
import logging
import sys
from shared.database.models import LeadOpportunity, BuyerStage, RecommendedAction, Brand
from shared.database.session import get_db, SessionLocal
import uuid

# Aggressive silence
logging.disable(logging.CRITICAL)

from sqlalchemy import text
import json

def seed():
    db = SessionLocal()
    try:
        # Clear existing?
        db.query(LeadOpportunity).delete()
        db.query(Brand).delete()
        
        # Raw SQL delete for tables not in models?
        db.execute(text('DELETE FROM core."EngagementEvent" WHERE id IN (\'evt-1\', \'evt-2\', \'evt-3\')'))
        
        # Insert Accounts
        db.execute(text("""
            INSERT INTO core."Account" (id, status, name)
            VALUES 
            ('a0000000-0000-0000-0000-000000000000', 'ACTIVE', 'Account A'),
            ('b0000000-0000-0000-0000-000000000000', 'ACTIVE', 'Account B')
            ON CONFLICT (id) DO NOTHING
        """))
        # Insert User (Raw SQL)
        user_hash = "$2b$10$BFYvaNhKmJlK5K7vLbjYcuJk7rMnNxJqxescEoAM3pfCVLHf4uKZy"
        db.execute(text(f"""
            INSERT INTO core."User" (id, email, password_hash, status, created_at)
            VALUES 
            ('u1', 'test@example.com', '{user_hash}', 'ACTIVE', now())
            ON CONFLICT (email) DO NOTHING
        """))

        # Insert WorkspaceMembership (Raw SQL)
        db.execute(text("""
            INSERT INTO core."WorkspaceMembership" (id, workspace_id, user_id, role, status)
            VALUES 
            ('wm1', 'a0000000-0000-0000-0000-000000000000', 'u1', 'OWNER', 'ACTIVE')
            ON CONFLICT (workspace_id, user_id) DO NOTHING
        """))

        # Insert Brand (Model)
        b1 = Brand(
            id="brand-1",
            workspace_id="a0000000-0000-0000-0000-000000000000",
            name="Brand A",
            domain="brand-a.com",
            domain_context={},
            status="ACTIVE"
        )
        db.add(b1)
        db.flush() # Ensure ID exists

        # Insert Events
        # id, dedup_key, platform, target_id, status, metadata
        events_sql = text("""
            INSERT INTO core."EngagementEvent" (id, dedup_key, platform, target_id, status, metadata, account_id)
            VALUES 
            ('evt-1', 'dk1', 'linkedin', 'target1', 'PROCESSED', '{}', 'a0000000-0000-0000-0000-000000000000'),
            ('evt-2', 'dk2', 'email', 'target2', 'PROCESSED', '{}', 'b0000000-0000-0000-0000-000000000000'),
            ('evt-3', 'dk3', 'linkedin', 'target3', 'PROCESSED', '{}', 'a0000000-0000-0000-0000-000000000000')
            ON CONFLICT (id) DO NOTHING
        """)
        db.execute(events_sql)
        
        # Lead 1: READY (acc-a)
        l1 = LeadOpportunity(
            id="00000000-0000-0000-0000-000000000001",
            account_id="a0000000-0000-0000-0000-000000000000",
            brand=b1,
            platform="linkedin",
            buyer_stage=BuyerStage.READY.value,
            intent="interested in demo",
            preferences={"tone": "concise"},
            user_handle="user-a",
            video_id="vid-1",
            comment_id="c1",
            confidence=0.9,
            recommended_action=RecommendedAction.RECOMMEND_DM.value,
            source_event_id="evt-1"
        )

        b2 = Brand(
             id="brand-2",
             workspace_id="b0000000-0000-0000-0000-000000000000",
             name="Brand B",
             domain="brand-b.com",
             domain_context={},
             status="ACTIVE"
        )
        db.add(b2)
        
        l2 = LeadOpportunity(
            id="00000000-0000-0000-0000-000000000002",
            account_id="b0000000-0000-0000-0000-000000000000",
            brand=b2,
            platform="email",
            buyer_stage=BuyerStage.EVALUATING.value, # Education -> Evaluating
            intent="learning",
            user_handle="user-b",
            video_id="vid-2",
            comment_id="c2",
            confidence=0.8,
            recommended_action=RecommendedAction.SILENT_CAPTURE.value,
            source_event_id="evt-2"
        )

        # Lead 3: AWARENESS (acc-a)
        l3 = LeadOpportunity(
            id="00000000-0000-0000-0000-000000000003",
            account_id="a0000000-0000-0000-0000-000000000000",
            brand=b1,
            platform="linkedin",
            buyer_stage=BuyerStage.AWARENESS.value,
            intent="just browsing",
            user_handle="user-a",
            video_id="vid-3",
            comment_id="c3",
            confidence=0.5,
            recommended_action=RecommendedAction.SILENT_CAPTURE.value,
            source_event_id="evt-3"
        )

        db.add(l1)
        db.add(l2)
        db.add(l3)
        db.commit()
        print("Seeded 3 leads.")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    seed()
