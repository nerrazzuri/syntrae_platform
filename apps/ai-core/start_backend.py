"""
Start the backend service with proper configuration.

Enhancements:
- --up-postgres: starts Postgres via docker compose and sets DATABASE_URL
- --docker-fullstack: starts the full stack (db, redis, qdrant, backend, frontend) via docker compose and exits
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path
import argparse
import time

# Add src directory to Python path
backend_dir = Path(__file__).parent
src_dir = backend_dir / "src"
sys.path.insert(0, str(src_dir))

from dotenv import load_dotenv


def _load_env_and_log(env_path: Path) -> None:
    if env_path.exists():
        print(f"Loading environment from: {env_path}")
        load_dotenv(env_path, override=True)
        api_key = os.getenv("OPENAI_API_KEY", "")
        if api_key:
            print(f"✓ API Key loaded: {api_key[:15]}...{api_key[-4:]}")
            print(f"  Length: {len(api_key)} characters")
        else:
            print("⚠️  Warning: No API key found in environment!")
    else:
        print(f"⚠️  Warning: .env file not found at {env_path}")


def _compose_cmd() -> list:
    """Return a docker compose command array, preferring 'docker compose'."""
    if shutil.which("docker"):
        return ["docker", "compose"]
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    return []


def _run_compose(compose_args: list, cwd: Path) -> int:
    cmd = _compose_cmd()
    if not cmd:
        print("❌ Docker (compose) not found. Please install Docker Desktop.")
        return 1
    full_cmd = cmd + compose_args
    print(f"→ Running: {' '.join(full_cmd)} (cwd={cwd})")
    proc = subprocess.run(full_cmd, cwd=str(cwd))
    return proc.returncode


def _get_container_id(service: str, cwd: Path) -> str:
    cmd = _compose_cmd()
    if not cmd:
        return ""
    try:
        proc = subprocess.run(
            cmd + ["ps", "-q", service], cwd=str(cwd), capture_output=True, text=True
        )
        cid = (proc.stdout or "").strip()
        return cid
    except Exception:
        return ""


def _wait_for_postgres_healthy(
    service: str, cwd: Path, timeout_seconds: int = 90
) -> bool:
    cid = _get_container_id(service, cwd)
    if not cid:
        print(
            "⚠️  Could not determine Postgres container id; proceeding without health wait."
        )
        return False
    cmd = ["docker", "inspect", "-f", "{{.State.Health.Status}}", cid]
    print("⏳ Waiting for Postgres to become healthy...")
    start = time.time()
    last_status = "starting"
    while time.time() - start < timeout_seconds:
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True)
            status = (proc.stdout or "").strip()
            if status != last_status:
                print(f"  status: {status}")
                last_status = status
            if status == "healthy":
                return True
        except Exception:
            pass
        time.sleep(2)
    print(
        "⚠️  Postgres did not report healthy within timeout; backend may attempt to connect and retry."
    )
    return False


def main():
    parser = argparse.ArgumentParser(description="Start AI Core backend service")
    parser.add_argument(
        "--up-postgres",
        action="store_true",
        help="Start Postgres via docker compose and set DATABASE_URL",
    )
    parser.add_argument(
        "--docker-fullstack",
        action="store_true",
        help="Start full stack via docker compose and exit",
    )
    parser.add_argument(
        "--reload", action="store_true", help="Enable uvicorn autoreload (dev only)"
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    backend_dir = Path(__file__).parent

    # Load environment only once at the beginning of the main entrypoint
    _load_env_and_log(backend_dir / ".env")

    if args.up_postgres:
        compose_file = repo_root / "docker-compose.yml"
        if not compose_file.exists():
            print(f"❌ docker-compose.yml not found at {compose_file}")
            sys.exit(1)
        rc = _run_compose(
            ["-f", str(compose_file), "up", "-d", "postgresql"], cwd=repo_root
        )
        if rc != 0:
            sys.exit(rc)
        # Point backend to the local Postgres started by compose
        os.environ.setdefault(
            "DATABASE_URL",
            "postgresql://chatbot_user:chatbot_password@localhost:5432/chatbot_dev",
        )
        print(f"✅ DATABASE_URL set to: {os.environ['DATABASE_URL']}")
        # Wait for container health before starting app
        _wait_for_postgres_healthy("postgresql", repo_root, timeout_seconds=90)

    if args.docker_fullstack:
        compose_file = repo_root / "docker-compose.yml"
        if not compose_file.exists():
            print(f"❌ docker-compose.yml not found at {compose_file}")
            sys.exit(1)
        # Detach so this script can exit cleanly
        rc = _run_compose(
            ["-f", str(compose_file), "up", "--build", "-d"], cwd=repo_root
        )
        if rc == 0:
            print("\n🚀 Full stack started in Docker (detached). Services:")
            print("- Postgres: localhost:5432")
            print("- Redis: localhost:6379")
            print("- Qdrant: http://localhost:6333")
            print("- AI Core: http://localhost:8000")
            print("- Gateway: http://localhost:3001")
            print("- Frontend: http://localhost:3000")
            print("Use 'docker compose logs -f' to view logs.")
        sys.exit(rc)

    print("\nStarting AI Core backend service...")
    print("=" * 50)
    return args


# Now import and run the main app
if __name__ == "__main__":
    # If invoked normally, run the CLI first and get args
    args = main()
    # Then start the local dev server
    import uvicorn

    uvicorn.run(
        "ai_core.main:app",
        host="0.0.0.0",
        port=8000,
        reload=args.reload,
        log_level="info",
    )
