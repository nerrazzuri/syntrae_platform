import json
import os
import argparse
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from shared.database.session import SessionLocal
from shared.database.models import FeedbackEvent

def generate_golden_dataset(tenant_id: str, output_path: str, limit: int = 100):
    """
    Extract positive feedback events and save them as a test suite.
    """
    db: Session = SessionLocal()
    try:
        # Query positive feedback
        events = (
            db.query(FeedbackEvent)
            .filter(FeedbackEvent.tenant_id == tenant_id)
            .filter(FeedbackEvent.label == "positive")
            .limit(limit)
            .all()
        )
        
        cases = []
        for event in events:
            # We assume the 'final_response' in the feedback event is the "correct" answer
            # because the user marked it as positive.
            # In a real system, we might want human curation here.
            if event.query and event.final_response:
                cases.append({
                    "query": event.query,
                    "answer": event.final_response,
                    "meta": {"source_event_id": str(event.id)}
                })
        
        dataset = {
            "description": f"Golden Dataset for tenant {tenant_id} generated from positive feedback",
            "cases": cases
        }
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(dataset, f, indent=2, ensure_ascii=False)
            
        print(f"Successfully generated golden dataset with {len(cases)} cases at {output_path}")
        
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Golden Dataset from Feedback")
    parser.add_argument("--tenant", required=True, help="Tenant ID")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--limit", type=int, default=100, help="Max events to process")
    
    args = parser.parse_args()
    generate_golden_dataset(args.tenant, args.output, args.limit)
