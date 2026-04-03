import subprocess
import json
import logging
from datetime import datetime

logger = logging.getLogger("Verification_WF1")
logging.basicConfig(level=logging.INFO)

def verify_db_snapshots():
    print("Verifying WF-1 DB State (Snapshot Persistence)...")
    
    # Query: Get the most recent automation execution
    # Ensure policy_snapshot and market_profile_snapshot are NOT NULL
    query = "SELECT id, policy_snapshot IS NOT NULL as has_policy, market_profile_snapshot IS NOT NULL as has_market, created_at FROM \"core\".\"AutomationRun\" ORDER BY created_at DESC LIMIT 1;"
    
    cmd = [
        "docker", "compose", "exec", "-t", "postgresql",
        "psql", "-U", "superuser", "-d", "syntrae_core", "-t", "-c", query
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="../../infra/compose")
        output = result.stdout.strip()
        
        if not output:
            print("FAIL: No AutomationRun found in DB.")
            return False
            
        parts = output.split('|')
        if len(parts) < 3:
            print(f"FAIL: Unexpected DB output format: {output}")
            return False
            
        run_id = parts[0].strip()
        has_policy = parts[1].strip() == 't'
        has_market = parts[2].strip() == 't'
        
        logger.info(f"Latest Run ID: {run_id}")
        
        if has_policy and has_market:
            print("SUCCESS: Both Snapshots Persisted.")
            print("WF-1 VERIFICATION PASSED")
            return True
        else:
            print(f"FAIL: Missing Snapshots. Policy: {has_policy}, Market: {has_market}")
            return False
            
    except Exception as e:
        print(f"FAIL: Exception during verification: {e}")
        return False

if __name__ == "__main__":
    verify_db_snapshots()
