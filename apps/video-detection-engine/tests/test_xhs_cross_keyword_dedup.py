import pytest

from video_detection_engine.core.discovery_engine import DiscoveryEngine
from video_detection_engine.platforms.xiaohongshu import XiaohongshuPlatform


class _FakeXhsClient:
    comment_calls = []

    def __init__(self, cookies):
        self.cookies = cookies

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get_all_comments(self, note_id, **kwargs):
        self.comment_calls.append(note_id)
        return {
            "comments": [
                {
                    "id": f"c-{note_id}",
                    "content": f"comment for {note_id}",
                    "user": {"id": "u-1", "nickname": "reader"},
                }
            ]
        }


@pytest.mark.asyncio
async def test_xhs_run_search_skips_excluded_note_ids(monkeypatch):
    monkeypatch.setattr(
        "video_detection_engine.platforms.xiaohongshu.XhsClient",
        _FakeXhsClient,
    )

    platform = XiaohongshuPlatform(session_path=None)
    monkeypatch.setattr(platform, "_load_cookies", lambda: {"a1": "cookie", "webId": "wid"})
    monkeypatch.setattr(
        platform,
        "_collect_search_posts",
        lambda client, keyword, posts_limit: [
            {
                "note_id": "note-1",
                "note_ref": "note-1",
                "author": "author-1",
                "title": "Post 1",
                "like_count": 12,
                "hashtags": [],
                "search_page": 1,
                "search_rank": 1,
            },
            {
                "note_id": "note-2",
                "note_ref": "note-2",
                "author": "author-2",
                "title": "Post 2",
                "like_count": 3,
                "hashtags": [],
                "search_page": 1,
                "search_rank": 2,
            },
        ],
    )

    payload = await platform.run_search(
        browser_page=None,
        keyword="keyword-b",
        exclude_note_ids={"note-1"},
        max_posts=2,
        max_comments_per_post=2,
    )

    assert payload["source_posts_processed"] == 1
    assert [post["video_id"] for post in payload["source_posts"]] == ["note-2"]
    assert [event["video_id"] for event in payload["events"]] == ["note-2"]
    assert _FakeXhsClient.comment_calls == ["note-2"]


class _FakeEnforcer:
    def __init__(self):
        self.policy = {
            "max_source_posts_per_run": 10,
            "max_comments_per_source_post": 2,
        }

    async def reserve_video_quota(self, requested):
        return type("Res", (), {"amount": requested, "key": "videos"})()

    async def reserve_comment_quota(self, requested):
        return type("Res", (), {"amount": requested, "key": "comments"})()

    async def release_video_quota(self, reservation, unused=0):
        return unused

    async def release_comment_quota(self, reservation, unused=0):
        return unused


class _FakeClient:
    def __init__(self):
        self.discovery_calls = []

    async def record_discovery(self, run_id, payload):
        self.discovery_calls.append((run_id, payload))

    async def check_video_eligibility(self, note_id, platform):
        return {"eligible": True}

    async def emit_batch(self, all_results, run_id):
        return (len(all_results), 0, [], {})


class _FakePlatform:
    seen_inputs = []

    def __init__(self, session_path):
        self.session_path = session_path

    async def run_search(self, browser_page, keyword, **kwargs):
        exclude_note_ids = set(kwargs.get("exclude_note_ids") or set())
        self.seen_inputs.append((keyword, exclude_note_ids))
        if keyword == "kw-1":
            return {
                "events": [
                    {
                        "video_id": "shared-note",
                        "referral_comment_id": "comment-1",
                    }
                ],
                "source_posts": [{"video_id": "shared-note"}],
                "source_posts_processed": 1,
            }
        return {
            "events": [],
            "source_posts": [],
            "source_posts_processed": 0,
        }


@pytest.mark.asyncio
async def test_discovery_engine_passes_seen_source_posts_across_keywords(monkeypatch):
    monkeypatch.setattr(
        "video_detection_engine.core.discovery_engine.SearchQueryBuilder.build_search_urls",
        lambda self, limit=3: ["url-1", "url-2"],
    )
    monkeypatch.setattr(
        "video_detection_engine.core.discovery_engine.SearchQueryBuilder.build_queries",
        lambda self, limit=3: ["kw-1", "kw-2"],
    )
    monkeypatch.setattr(
        "video_detection_engine.core.discovery_engine.SearchQueryBuilder.evaluate_geo_candidate",
        lambda self, item, keyword: {"allowed": True, "status": "CONFIRMED_MATCH", "reasons": []},
    )
    monkeypatch.setattr(
        "video_detection_engine.core.discovery_engine.XiaohongshuPlatform",
        _FakePlatform,
    )
    _FakePlatform.seen_inputs = []

    client = _FakeClient()
    engine = DiscoveryEngine(
        controller=None,
        client=client,
        run_id="run-1",
        brand_id="brand-1",
        enforcer=_FakeEnforcer(),
        platform="xiaohongshu",
        xhs_session_path="/tmp/session.json",
    )

    await engine.execute({"primary_category": "wellness"}, finalize=False)

    assert _FakePlatform.seen_inputs == [
        ("kw-1", set()),
        ("kw-2", {"shared-note"}),
    ]
