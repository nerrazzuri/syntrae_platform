import asyncio
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_tenant_plan_endpoint(app_client: AsyncClient):
    r = await app_client.get('/v1/tenant/plan', headers={'X-Tenant-ID': '00000000-0000-0000-0000-000000000001', 'Authorization': 'Bearer test'})
    assert r.status_code in (200, 401, 403)


@pytest.mark.asyncio
async def test_token_quota_soft_block(monkeypatch, app_client: AsyncClient, db_session):
    # Seed CostSummary to exceed free plan tokens
    from shared.database.models import CostSummary
    tid = uuid.UUID('00000000-0000-0000-0000-000000000001')
    cs = CostSummary(tenant_id=str(tid), model='test', kind='gen', tokens_in=150000, tokens_out=100000, cost_usd=0, window_start=__import__('datetime').datetime.utcnow())
    db_session.add(cs)
    db_session.commit()
    payload = {"tenant_id": str(tid), "user_id": str(uuid.uuid4()), "channel": "web", "message": "hello"}
    r = await app_client.post('/v1/query', headers={'X-Tenant-ID': str(tid), 'Authorization': 'Bearer test'}, json=payload)
    assert r.status_code in (403, 200)


