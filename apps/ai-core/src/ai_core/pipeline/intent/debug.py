from __future__ import annotations

import argparse
from ai_core.pipeline.intent.router import HybridContextualRouter


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--user", default="demo")
    args = ap.parse_args()

    router = HybridContextualRouter()
    decision = router.classify(
        args.query, conversation_context=[], tenant_id=args.tenant, user_id=args.user
    )
    import json

    print(json.dumps(decision.__dict__, indent=2))


if __name__ == "__main__":
    main()
