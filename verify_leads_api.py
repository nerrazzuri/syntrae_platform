import requests
import sys
import time

BASE_URL = "http://operator-api:3001"
TOKEN_A = "sess-token-user-a"
TOKEN_B = "sess-token-user-b"

def wait_for_api():
    for _ in range(10):
        try:
            requests.get(f"{BASE_URL}/health", timeout=2)
            return
        except:
            time.sleep(1)
    print("API not reachable")

def test_list_a():
    headers = {"Authorization": f"Bearer {TOKEN_A}"}
    resp = requests.get(f"{BASE_URL}/leads", headers=headers)
    assert resp.status_code == 200, f"A failed: {resp.text}"
    data = resp.json()
    items = data["items"]
    assert len(items) == 1, f"Expected 1 item for A, got {len(items)}"
    assert items[0]["id"] == "lead-1-acc-a"
    print("User A List: PASS")

def test_list_b():
    headers = {"Authorization": f"Bearer {TOKEN_B}"}
    resp = requests.get(f"{BASE_URL}/leads", headers=headers)
    assert resp.status_code == 200, f"B failed: {resp.text}"
    data = resp.json()
    items = data["items"]
    assert len(items) == 1, f"Expected 1 item for B, got {len(items)}"
    assert items[0]["id"] == "lead-2-acc-b"
    print("User B List: PASS")

def test_export_a():
    headers = {"Authorization": f"Bearer {TOKEN_A}"}
    resp = requests.get(f"{BASE_URL}/leads/export", headers=headers)
    assert resp.status_code == 200, f"Export failed: {resp.text}"
    assert "text/csv" in resp.headers["Content-Type"]
    content = resp.text
    assert "platform,buyer_stage" in content
    assert "vid-1" in content
    assert "vid-2" not in content
    print("User A Export: PASS")

if __name__ == "__main__":
    try:
        wait_for_api()
        test_list_a()
        test_list_b()
        test_export_a()
        print("ALL TESTS PASSED")
    except Exception as e:
        print(f"FAILED: {e}")
        sys.exit(1)
