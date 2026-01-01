
import requests
import json
import logging
import sys
import os
from datetime import datetime
from sqlalchemy import create_engine, text
import time

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Config
API_BASE = "http://localhost:3001/api"
DB_URL = os.getenv("DATABASE_URL", "postgresql://superuser:Syntrae%212025_dbRoot%23A9@localhost:5432/syntrae_core")

def setup_data():
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        logging.info("Setting up test data via Raw SQL...")
        
        # 1. Cleanup (Respect FK order)
        conn.execute(text("DELETE FROM core.\"ManualSendEvent\" WHERE brand_id = 'brand-1'"))
        conn.execute(text("DELETE FROM core.\"OutreachDraft\" WHERE brand_id = 'brand-1'"))
        conn.execute(text("DELETE FROM core.\"LeadOpportunity\" WHERE brand_id = 'brand-1'"))
        conn.execute(text("DELETE FROM core.\"EngagementEvent\" WHERE brand_id = 'brand-1'"))
        conn.execute(text("DELETE FROM core.\"Brand\" WHERE id = 'brand-1'"))
        conn.execute(text("DELETE FROM core.\"Session\" WHERE user_id = 'u1'"))
        conn.execute(text("DELETE FROM core.\"WorkspaceMembership\" WHERE user_id = 'u1'"))
        conn.execute(text("DELETE FROM core.\"User\" WHERE email = 'test@example.com'"))
        conn.execute(text("DELETE FROM core.\"Account\" WHERE id = 'acc-1'"))
        conn.commit()

        # 2. Account
        conn.execute(text("""
            INSERT INTO core."Account" (id, status, name)
            VALUES ('acc-1', 'ACTIVE', 'Test Account')
            ON CONFLICT (id) DO NOTHING
        """))

        # 3. User
        user_hash = "$2b$10$BFYvaNhKmJlK5K7vLbjYcuJk7rMnNxJqxescEoAM3pfCVLHf4uKZy"
        conn.execute(text(f"""
            INSERT INTO core."User" (id, email, password_hash, status, created_at)
            VALUES ('u1', 'test@example.com', '{user_hash}', 'ACTIVE', now())
            ON CONFLICT (email) DO NOTHING
        """))

        # 4. Membership
        conn.execute(text("""
            INSERT INTO core."WorkspaceMembership" (id, workspace_id, user_id, role, status)
            VALUES ('wm1', 'acc-1', 'u1', 'OWNER', 'ACTIVE')
            ON CONFLICT (workspace_id, user_id) DO NOTHING
        """))

        # 5. Brand
        conn.execute(text("""
            INSERT INTO core."Brand" (id, workspace_id, name, domain, domain_context, status, created_at, updated_at)
            VALUES ('brand-1', 'acc-1', 'Brand A', 'brand-a.com', '{}', 'ACTIVE', now(), now())
        """))

        # 6. EngagementEvent (Required for Lead source FK, and requires Brand FK)
        conn.execute(text("DELETE FROM core.\"EngagementEvent\" WHERE id = 'evt-1'"))
        conn.execute(text("""
            INSERT INTO core."EngagementEvent" (id, dedup_key, platform, target_id, status, metadata, account_id, brand_id, created_at)
            VALUES 
            ('evt-1', 'dk1', 'linkedin', 'target1', 'PROCESSED', '{}', 'acc-1', 'brand-1', now())
            ON CONFLICT (id) DO NOTHING
        """))

        # 7. Lead (Minimal params for constraint satisfaction)
        # Note: Enum values in Postgres are usually lowercase strings unless mapped differently. But mostly just strings.
        conn.execute(text("""
            INSERT INTO core."LeadOpportunity" 
            (id, brand_id, account_id, platform, video_id, comment_id, buyer_stage, intent, confidence, recommended_action, source_event_id, urgency_score, risk_level, created_at)
            VALUES 
            ('l1', 'brand-1', 'acc-1', 'linkedin', 'v1', 'c1', 'READY', 'demo', 0.9, 'RECOMMEND_DM', 'evt-1', 0, 'LOW', now())
        """))
        
        # 7. Draft (Initial DRAFT for verification)
        conn.execute(text("""
            INSERT INTO core."OutreachDraft" 
            (id, lead_id, account_id, brand_id, platform, buyer_stage, tone, language, draft_text, generation_meta, status, created_at, updated_at)
            VALUES 
            ('d1', 'l1', 'acc-1', 'brand-1', 'linkedin', 'READY', 'concise', 'English', 'Hello there', '{}', 'DRAFT', now(), now())
        """))
        
        conn.commit()
        logging.info("Test data setup complete.")
        return 'd1'

def verify():
    draft_id = setup_data()

    # 1. Login
    s = requests.Session()
    # Retry connection a few times if API is starting up
    for i in range(5):
        try:
            r = s.post(f"{API_BASE}/login", json={"email": "test@example.com", "password": "password123"})
            if r.status_code == 200:
                break
        except requests.exceptions.ConnectionError:
            logging.warning("API not ready, retrying...")
            time.sleep(2)
    else:
        logging.error("Could not connect to API")
        sys.exit(1)
        
    logging.info("Login Successful")
    
    # 2. Test: Edit Draft (DRAFT -> EDITED)
    edit_payload = { "edited_text": "Hello there (edited)" }
    r = s.post(f"{API_BASE}/drafts/{draft_id}/edit", json=edit_payload)
    if r.status_code != 200:
        logging.error(f"Edit Failed: {r.text}")
        sys.exit(1)
    
    data = r.json()
    if data['status'] != 'EDITED':
        logging.error(f"Status mismatch: Expected EDITED, got {data['status']}")
        sys.exit(1)
        
    logging.info("Transition: DRAFT -> EDITED [OK]")

    # 2b. Test: Mark Sent on EDITED (Should Fail - Strict State Machine)
    r = s.post(f"{API_BASE}/drafts/{draft_id}/mark-sent", json={
        "sent_text": "Premature send",
        "confirmation_ack": True
    })
    if r.status_code == 400:
        logging.info("State Machine Check: Mark Sent on EDITED draft failed as expected [OK]")
    else:
        logging.error(f"State Machine Check Failed: Expected 400 for Mark Sent on EDITED, got {r.status_code}")
        sys.exit(1)

    # 3. Test: Approve Draft (EDITED -> APPROVED)
    r = s.post(f"{API_BASE}/drafts/{draft_id}/approve", json={})
    if r.status_code != 200:
        logging.error(f"Approve Failed: {r.text}")
        sys.exit(1)

    data = r.json()
    if data['status'] != 'APPROVED':
        logging.error(f"Status mismatch: Expected APPROVED, got {data['status']}")
        sys.exit(1)
    if not data['approved_at']:
        logging.error("approved_at missing")
        sys.exit(1)

    logging.info("Transition: EDITED -> APPROVED [OK]")

    # 4. Test: Edit Approved Draft (APPROVED -> EDITED) - Should clear approval
    edit_payload_2 = { "edited_text": "Hello there (edited again)" }
    r = s.post(f"{API_BASE}/drafts/{draft_id}/edit", json=edit_payload_2)
    if r.status_code != 200:
         logging.error(f"Re-Edit Failed: {r.text}")
         sys.exit(1)
    
    data = r.json()
    if data['status'] != 'EDITED':
         logging.error(f"Status mismatch: Expected EDITED, got {data['status']}")
         sys.exit(1)
    if data.get('approved_at') is not None:
         logging.error("approved_at NOT cleared after edit!")
         sys.exit(1)

    logging.info("Transition: APPROVED -> EDITED (Approval Cleared) [OK]")

    # 5. Re-Approve
    r = s.post(f"{API_BASE}/drafts/{draft_id}/approve", json={})
    if r.status_code != 200:
        logging.error("Re-Approve failed")
        sys.exit(1)
    logging.info("Re-Approved [OK]")

    # 6. Mark Sent (APPROVED -> SENT)
    sent_payload = {
        "sent_text": "Hello there (edited again)",
        "platform": "linkedin",
        "send_mode": "COPY_PASTE",
        "confirmation_ack": True
    }
    r = s.post(f"{API_BASE}/drafts/{draft_id}/mark-sent", json=sent_payload)
    if r.status_code != 200:
        logging.error(f"Mark Sent Failed: {r.text}")
        sys.exit(1)
    
    data = r.json()
    if data['status'] != 'SENT':
        logging.error(f"Status mismatch: Expected SENT, got {data['status']}")
        sys.exit(1)
    
    logging.info("Transition: APPROVED -> SENT [OK]")

    # 7. Test Immutability: Try Editing SENT draft
    r = s.post(f"{API_BASE}/drafts/{draft_id}/edit", json={"edited_text": "Should fail"})
    if r.status_code == 400:
        logging.info("Immutability Check: Edit SENT draft failed as expected [OK]")
    else:
        logging.error(f"Immutability Check Failed: Expected 400, got {r.status_code}")
        sys.exit(1)

    logging.info("=== All Draft Lifecycle Tests Passed ===")

if __name__ == "__main__":
    verify()
