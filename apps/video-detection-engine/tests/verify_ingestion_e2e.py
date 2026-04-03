import requests
import json
import uuid
import datetime

INGESTION_URL = "http://localhost:3000/events"

def test_automation_contract():
    """
    Verifies that Ingestion Service accepts the Strict Automation Schema.
    """
    print(f"Testing Ingestion Contract at {INGESTION_URL}...")
    
    # 1. Valid Payload
    payload = {
        "event_type": "DESKTOP_CAPTURE",
        "platform": "tiktok",
        "session": {
            "session_id": str(uuid.uuid4()),
            "install_id": "test_install_id", 
            "brand_id": str(uuid.uuid4())
        },
        "page": {
            "url": "https://www.tiktok.com/@user/video/123456",
            "page_type": "VIDEO",
            "timestamp": datetime.datetime.now().isoformat()
        },
        "video": {
            "video_id": "123456",
            "video_url": "https://www.tiktok.com/@user/video/123456",
            "title": "Test Video",
            "author_id": "user123",
            "author_name": "Test User"
        },
        "comment": {
            "comment_id": "comment_1",
            "author_id": "user456",
            "author_name": "Commenter",
            "text": "This is a valid real comment.",
            "reply_count": 0,
            "like_count": 0
        },
        "context": {
            "source": "AUTOMATION",
            "automation_run_id": "run_test_123", # CRITICAL: Must be present
            "visible": True,
            "position": "viewport",
            "user_action": "automation_capture"
        },
        "client_meta": {
            "extension_version": "0.0.1",
            "browser": "playwright",
            "os": "windows"
        }
    }
    
    try:
        # We expect 400 because install_id likely doesn't exist in local DB (Orphaned).
        # But specifically, we check if it passes ZOD and Validation.
        # If schema is invalid -> 400 INVALID_PAYLOAD.
        # If strict validation fails -> 400 INVALID_AUTOMATION_EVENT.
        # If install missing -> 400 Missing x-install-id (header) OR 202 Accepted (with status ORPHANED).
        # Ingest code:
        # If !installId (header) -> 400.
        
        headers = {
            "x-install-id": "test_install_id",
            "x-install-secret": "secret",
            "Content-Type": "application/json"
        }
        
        resp = requests.post(INGESTION_URL, json=payload, headers=headers)
        
        print(f"Response Status: {resp.status_code}")
        print(f"Response Body: {resp.text}")
        
        if resp.status_code == 202:
            print("SUCCESS: Event Accepted (Contract Valid).")
            
            # Phase 2: Verify DB Side Effects (E2E)
            # We assume running on Host where docker is available.
            print("Verifying Database Side Effects...")
            import subprocess
            import time
            
            time.sleep(5) # Wait for async processing (RabbitMQ -> Ingestion -> AI Core -> Operator)
            
            check_sql = f"""
            SELECT count(*) FROM "Lead" WHERE "source" = 'AUTOMATION' AND "created_at" > NOW() - INTERVAL '1 minute';
            """
            
            try:
                # Docker Compose Service Name for DB: compose-postgresql-1 or postgres
                # Try finding container name dynamically or use standard
                cmd = [
                    "docker", "compose", "exec", "-t", "postgres", 
                    "psql", "-U", "postgres", "-d", "syntrae_db", "-t", "-c", check_sql
                ]
                
                # Using 'postgres' service name from compose might need --index 1, or just container name. 
                # Safe bet: try `docker compose exec postgres`
                
                # Check for Draft too
                draft_sql = f"""
                SELECT count(*) FROM "OutreachDraft" WHERE "status" = 'DRAFT' AND "created_at" > NOW() - INTERVAL '1 minute';
                """
                
                print("Checking Lead creation...")
                lead_out = subprocess.check_output(cmd, cwd="../../infra/compose").decode().strip()
                if int(lead_out) > 0:
                    print("SUCCESS: Lead created in DB.")
                else:
                     print("FAIL: Lead NOT found in DB.")
                
                print("Checking Draft creation...")
                cmd[-1] = draft_sql
                draft_out = subprocess.check_output(cmd, cwd="../../infra/compose").decode().strip()
                if int(draft_out) > 0:
                    print("SUCCESS: Draft created in DB.")
                else:
                    print("FAIL: Draft NOT found in DB.")

            except Exception as e:
                print(f"DB Verification Skipped/Failed (Docker issue?): {e}")

        elif resp.status_code == 400:
             data = resp.json()
             if data.get("code") == "INVALID_PAYLOAD":
                 print("FAIL: Schema Mismatch (Zod).")
             elif data.get("code") == "INVALID_AUTOMATION_EVENT":
                 print("FAIL: Strict Automation Validation Failed.")
             else:
                 print(f"FAIL: Other 400 Error: {data.get('message')}")
        else:
            print("FAIL: Unexpected Status.")
            
    except Exception as e:
        print(f"CRITICAL: Connection Failed: {e}")

if __name__ == "__main__":
    test_automation_contract()
