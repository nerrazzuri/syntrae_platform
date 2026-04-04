import requests
import sys
import uuid
import time

BASE_URL = "http://localhost/api" 
# Assuming NGINX is running on port 80 and proxying /api to operator-api:3001
# If NGINX is not running, we can't access it from host easily without port 3001 exposed.
# But verify_draft_gen.py used "http://operator-api:3001", enabling it to run INSIDE docker network.
# I will try localhost:80/api first. If fails, user needs to run inside container.

EMAIL = f"billing_test_{uuid.uuid4()}@test.com"
PASSWORD = "Password123!"

session = requests.Session()

def log(msg):
    print(f"[TEST] {msg}")

def check(response, expected_status=200, errMsg=""):
    if response.status_code != expected_status:
        print(f"FAILED: {errMsg}. Got {response.status_code}. Body: {response.text}")
        sys.exit(1)
    return response.json()

def run_test():
    log(f"Starting Billing Test with user {EMAIL}")

    # 1. Signup
    log("Signing up...")
    res = session.post(f"{BASE_URL}/auth/signup", json={
        "email": EMAIL,
        "password": PASSWORD,
        "name": "Billing Tester"
    })
    check(res, 201, "Signup failed")
    
    # 2. Get Me (Workspace Info)
    log("Fetching Profile...")
    res = session.get(f"{BASE_URL}/auth/me")
    data = check(res, 200, "Get Me failed")
    workspace_id = data['active_workspace']['id']
    plan = data['active_workspace']['plan_id']
    status = data['active_workspace']['status']
    
    log(f"Workspace: {workspace_id}, Plan: {plan}, Status: {status}")
    if plan != 'STARTER':
        print("FAILED: Expected initial plan to be STARTER")
        sys.exit(1)

    # 3. Create Brand 1 (Should Succeed - Default brand might already exist?)
    # "Signup -> Default Brand exists" (Prompt says).
    # Let's check brand list.
    log("Checking existing brands...")
    res = session.get(f"{BASE_URL}/brands")
    brands = check(res, 200, "List brands failed")
    log(f"Found {len(brands)} brands.")
    
    if len(brands) == 1:
        log("Default brand found. Trying to create 2nd brand (Should Fail)...")
        res = session.post(f"{BASE_URL}/brands", json={
            "name": "Brand 2",
            "domain": "brand2.com"
        })
        if res.status_code != 403:
            print(f"FAILED: Expected 403 Forbidden for Brand Limit, got {res.status_code}")
            sys.exit(1)
        log("PASS: Blocked creation of 2nd brand on STARTER package.")
    else:
        # Create Brand 1
        log("Creating Brand 1...")
        session.post(f"{BASE_URL}/brands", json={"name": "Brand 1", "domain": "b1.com"})
        
        # Create Brand 2
        log("Creating Brand 2 (Should Fail)...")
        res = session.post(f"{BASE_URL}/brands", json={"name": "Brand 2", "domain": "b2.com"})
        if res.status_code != 403:
             print(f"FAILED: Expected 403 Forbidden, got {res.status_code}")
             sys.exit(1)
        log("PASS: Blocked creation.")

    # 4. Upgrade to PRO
    log("Upgrading to PRO...")
    res = session.post(f"{BASE_URL}/billing/upgrade")
    check(res, 200, "Upgrade failed")
    
    # Verify Plan
    res = session.get(f"{BASE_URL}/auth/me")
    data = check(res, 200)
    if data['active_workspace']['plan_id'] != 'PRO':
        print("FAILED: Plan did not update to PRO")
        sys.exit(1)
    log("PASS: Upgraded to PRO.")

    # 5. Create Brand 2 (Should Succeed)
    log("Creating Brand 2 (Should Succeed)...")
    res = session.post(f"{BASE_URL}/brands", json={"name": "Brand 2", "domain": "brand2.com"})
    brand2 = check(res, 201, "Brand 2 creation failed")
    brand2_id = brand2['id']
    log(f"PASS: Created Brand 2 ({brand2_id}).")

    # 6. Downgrade to STARTER
    log("Downgrading to STARTER (Should enter PENDING state)...")
    res = session.post(f"{BASE_URL}/billing/downgrade")
    data = check(res, 200, "Downgrade request failed")
    
    if data['account_status'] != 'PENDING_DOWNGRADE':
        print(f"FAILED: Expected PENDING_DOWNGRADE, got {data['account_status']}")
        sys.exit(1)
    log("PASS: Account is PENDING_DOWNGRADE.")

    # 7. Resolve Downgrade (Keep Brand 2)
    log("Resolving Downgrade (Keeping Brand 2)...")
    res = session.post(f"{BASE_URL}/billing/resolve-downgrade", json={
        "keep_brand_id": brand2_id
    })
    check(res, 200, "Resolution failed")

    # 8. Verify Final State
    log("Verifying Final State...")
    res = session.get(f"{BASE_URL}/auth/me")
    data = check(res, 200)
    if data['active_workspace']['plan_id'] != 'STARTER':
        print("FAILED: Final plan is not STARTER")
        sys.exit(1)
    if data['active_workspace']['status'] != 'ACTIVE':
        print("FAILED: Final status is not ACTIVE")
        sys.exit(1)
    
    # Verify Brands Status
    res = session.get(f"{BASE_URL}/brands")
    brands = check(res, 200)
    
    b2 = next(b for b in brands if b['id'] == brand2_id)
    others = [b for b in brands if b['id'] != brand2_id]
    
    if b2['status'] != 'ACTIVE':
        print("FAILED: Brand 2 should be ACTIVE")
        sys.exit(1)
    
    for b in others:
        if b['status'] != 'PAUSED':
            print(f"FAILED: Brand {b['name']} should be PAUSED")
            sys.exit(1)

    log("PASS: Downgrade logic verified.")
    print("ALL TESTS PASSED")

if __name__ == "__main__":
    try:
        run_test()
    except requests.exceptions.ConnectionError:
        print("FAILED: Could not connect to API. Is Docker/NGINX running on port 80?")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
