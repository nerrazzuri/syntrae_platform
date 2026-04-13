import pytest

from behavior.enforcer import PolicyEnforcer
from behavior.quota_store import QuotaReservation


class MemoryQuotaStore:
    def __init__(self):
        self.values = {}

    def quota_key(self, brand_id: str, platform: str, metric: str) -> str:
        return f"test:{brand_id}:{platform}:{metric}"

    async def reserve(self, key: str, requested: int, limit: int) -> int:
        current = self.values.get(key, 0)
        amount = min(requested, max(0, limit - current))
        self.values[key] = current + amount
        return amount

    async def release(self, reservation: QuotaReservation | None, unused: int) -> int:
        if not reservation or unused <= 0:
            return 0
        current = self.values.get(reservation.key, 0)
        amount = min(unused, reservation.amount, current)
        self.values[reservation.key] = max(0, current - amount)
        return amount


@pytest.mark.asyncio
async def test_policy_enforcer_reserves_and_releases_shared_quota():
    store = MemoryQuotaStore()
    enforcer = PolicyEnforcer(
        {
            "enabled": True,
            "status": "ACTIVE",
            "max_videos_per_hour": 2,
            "max_comments_per_video": 3,
            "max_comments_per_hour": 4,
        },
        brand_id="brand-1",
        platform="rednote",
        quota_store=store,
    )

    video_reservation = await enforcer.reserve_video_quota(2)
    assert video_reservation is not None
    assert video_reservation.amount == 2
    assert await enforcer.reserve_video_quota() is None

    assert await enforcer.release_video_quota(video_reservation, 1) == 1
    assert (await enforcer.reserve_video_quota()).amount == 1

    comment_reservation = await enforcer.reserve_comment_quota(10)
    assert comment_reservation is not None
    assert comment_reservation.amount == 4
    assert await enforcer.reserve_comment_quota(1) is None

    assert await enforcer.release_comment_quota(comment_reservation, 2) == 2
    next_reservation = await enforcer.reserve_comment_quota(10)
    assert next_reservation is not None
    assert next_reservation.amount == 2
