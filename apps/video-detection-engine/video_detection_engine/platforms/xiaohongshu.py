import hashlib
import json as json_lib
import logging
import math
from datetime import datetime, timezone
from pathlib import Path

from xhs_cli.client import XhsClient
from xhs_cli.exceptions import XhsApiError

logger = logging.getLogger(__name__)


class XiaohongshuPlatform:
    DEFAULT_POSTS_PER_KEYWORD = 20
    DEFAULT_SEARCH_PAGES = 3
    MAX_SEARCH_PAGES = 5
    SEARCH_PAGE_SIZE = 20
    DEFAULT_COMMENTS_PER_POST = 10
    DEFAULT_COMMENT_PAGES = 3
    """
    Xiaohongshu discovery adapter backed by the xiaohongshu-cli Python package.

    Runtime requirement:
    - read brand-scoped captured cookies from the Syntrae-managed session payload
    - do not rely on Playwright or an interactive browser during search/comment collection
    """

    def __init__(self, session_path: str | None = None):
        self.session_path = session_path

    async def run_search(
        self,
        browser_page,
        keyword,
        run_id: str | None = None,
        record_discovery=None,
        is_video_eligible=None,
        max_posts: int | None = None,
        max_comments_per_post: int | None = None,
        max_comment_pages: int | None = None,
    ):
        logger.info("Starting Xiaohongshu Discovery via XHS client for keyword: %s", keyword)
        posts_limit = max(1, int(max_posts or self.DEFAULT_POSTS_PER_KEYWORD))
        comments_limit = max(1, int(max_comments_per_post or self.DEFAULT_COMMENTS_PER_POST))
        comment_pages = max(1, int(max_comment_pages or self.DEFAULT_COMMENT_PAGES))

        cookies = self._load_cookies()
        if not cookies:
            logger.error("No XHS cookies available in %s", self.session_path)
            return {"events": [], "source_posts_processed": 0}

        posts = []
        try:
            with XhsClient(cookies) as client:
                posts = self._collect_search_posts(client, keyword, posts_limit)
        except Exception as exc:
            logger.error("Failed to execute XHS search client: %s", exc)

        if not posts:
            logger.warning(
                "No search results found for keyword: %s. If cookies are stale, reconnect the brand-scoped XHS session.",
                keyword,
            )
            return {"events": [], "source_posts_processed": 0}

        logger.info("Extracted %s posts from XHS search results", len(posts))

        final_events = []
        processed_note_ids = set()
        for post in posts[:posts_limit]:
            note_id = post["note_id"]
            post_url = self._build_note_url(
                post.get("note_ref") or note_id,
                note_id,
                post.get("xsec_token"),
                post.get("xsec_source"),
            )
            post_author = self._normalize_text(post["author"])

            if is_video_eligible:
                eligibility = await is_video_eligible(note_id)
                if not eligibility.get("eligible", True):
                    logger.info(
                        "Skipping XHS note %s due to cooldown until %s",
                        note_id,
                        eligibility.get("cooldown_until"),
                    )
                    continue

            if run_id and callable(record_discovery):
                await record_discovery(run_id, {
                    "brand_id": None,
                    "platform": "rednote",
                    "video_id": note_id,
                    "video_url": post_url,
                    "market_score": 0,
                    "reasons": [
                        f"XHS_SOURCE_POST_SELECTED:{keyword}",
                        f"SEARCH_PAGE:{post.get('search_page', 1)}",
                        f"SEARCH_RANK:{post.get('search_rank', 1)}",
                    ],
                    "decision": "ACCEPT",
                    "market_profile_id": None,
                    "market_profile_version": None,
                })

            processed_note_ids.add(note_id)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            base_event = {
                "platform": "rednote",
                "video_id": note_id,
                "video_url": post_url,
                "caption": post["title"],
                "video_author_name": post_author,
                "like_count": post["like_count"],
                "reply_count": 0,
                "hashtags": [],
                "page_url": post_url,
                "page_timestamp": now,
                "search_keyword": keyword,
                "search_page": post.get("search_page", 1),
                "search_rank": post.get("search_rank", 1),
            }

            logger.info("Fetching real comments for note %s using XHS client...", note_id)
            real_comments = []
            try:
                with XhsClient(cookies) as client:
                    comment_kwargs = {"max_pages": comment_pages}
                    if post.get("xsec_token"):
                        comment_kwargs["xsec_token"] = post["xsec_token"]
                        comment_kwargs["xsec_source"] = post.get("xsec_source") or "pc_search"
                    data = client.get_all_comments(note_id, **comment_kwargs)
                    comments = data.get("comments", []) if isinstance(data, dict) else []
                    real_comments.extend(comments)
            except XhsApiError as exc:
                logger.warning("XHS comments failed for %s: %s", note_id, exc)
            except Exception as exc:
                logger.error("Failed to fetch comments via XHS client: %s", exc)

            if not real_comments:
                logger.info("No real comments found for %s; skipping emission", note_id)
                continue

            logger.info("Successfully fetched %s real comments for %s", len(real_comments), note_id)
            seen_comment_ids = set()
            post_events = []
            for cmt in real_comments:
                if len(post_events) >= comments_limit:
                    break
                raw_text = self._extract_comment_text(cmt)
                comment_user = self._extract_comment_user(cmt)
                comment_author = self._extract_comment_author_name(cmt, comment_user)
                comment_author_id = self._extract_comment_author_id(cmt, comment_user)
                comment_id = self._build_comment_id(cmt, note_id, raw_text, comment_author_id)

                if not comment_id or not raw_text:
                    continue

                if comment_id in seen_comment_ids:
                    continue
                seen_comment_ids.add(comment_id)

                if post_author and comment_author and comment_author == post_author:
                    logger.info("Skipping self-authored XHS comment %s on note %s", comment_id, note_id)
                    continue

                event = base_event.copy()
                event["content_text"] = raw_text
                event["comment_author_name"] = comment_author or "unknown"
                event["comment_author_id"] = comment_author_id
                event["like_count"] = int(cmt.get("like_count", 0))
                event["referral_comment_id"] = comment_id
                post_events.append(event)

            if post_events:
                final_events.extend(post_events)

        return {
            "events": final_events,
            "source_posts_processed": len(processed_note_ids),
        }

    def _collect_search_posts(self, client: XhsClient, keyword: str, posts_limit: int) -> list[dict]:
        target_pages = max(
            self.DEFAULT_SEARCH_PAGES,
            math.ceil(max(1, posts_limit) / self.SEARCH_PAGE_SIZE),
        )
        page_count = min(self.MAX_SEARCH_PAGES, target_pages)

        page_batches: list[list[dict]] = []
        seen_note_ids: set[str] = set()

        for page in range(1, page_count + 1):
            try:
                data = client.search_notes(keyword, page=page, page_size=self.SEARCH_PAGE_SIZE)
            except Exception as exc:
                logger.warning("XHS search page %s failed for %s: %s", page, keyword, exc)
                continue

            items = data.get("items", []) if isinstance(data, dict) else []
            batch = []
            for index, item in enumerate(items, start=1):
                post = self._normalize_search_item(item, keyword, page, index)
                note_id = post.get("note_id")
                if not note_id or note_id in seen_note_ids:
                    continue
                seen_note_ids.add(note_id)
                batch.append(post)

            logger.info(
                "XHS search page %s for '%s' returned %s unique posts",
                page,
                keyword,
                len(batch),
            )
            if batch:
                page_batches.append(batch)

            if len(batch) < self.SEARCH_PAGE_SIZE:
                logger.info(
                    "XHS search page %s for '%s' appears exhausted; stopping page walk",
                    page,
                    keyword,
                )
                break

        if not page_batches:
            return []

        posts = self._interleave_post_batches(page_batches, posts_limit)
        logger.info(
            "Collected %s diversified XHS posts for '%s' across %s page(s)",
            len(posts),
            keyword,
            len(page_batches),
        )
        return posts

    def _normalize_search_item(self, item: dict, keyword: str, search_page: int, page_rank: int) -> dict:
        note_card = item.get("note_card", {})
        note_ref = self._normalize_text(item.get("id", note_card.get("note_id", "")))
        xsec_token = self._normalize_text(
            item.get("xsec_token")
            or note_card.get("xsec_token")
            or note_card.get("xsecToken")
        )
        xsec_source = self._normalize_text(
            item.get("xsec_source")
            or note_card.get("xsec_source")
            or note_card.get("xsecSource")
        )
        return {
            "note_id": self._extract_note_id(note_ref),
            "note_ref": note_ref,
            "title": note_card.get("display_title", keyword),
            "author": note_card.get("user", {}).get("nickname", "unknown"),
            "like_count": int(note_card.get("interact_info", {}).get("liked_count", 0)),
            "xsec_token": xsec_token,
            "xsec_source": xsec_source,
            "search_page": search_page,
            "page_rank": page_rank,
        }

    @staticmethod
    def _interleave_post_batches(page_batches: list[list[dict]], posts_limit: int) -> list[dict]:
        interleaved: list[dict] = []
        max_batch_size = max((len(batch) for batch in page_batches), default=0)
        for row in range(max_batch_size):
            for batch in page_batches:
                if row < len(batch):
                    post = dict(batch[row])
                    post["search_rank"] = len(interleaved) + 1
                    interleaved.append(post)
                    if len(interleaved) >= posts_limit:
                        return interleaved
        return interleaved

    def _load_cookies(self) -> dict[str, str]:
        if not self.session_path:
            return {}

        try:
            payload = json_lib.loads(Path(self.session_path).read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error("Failed to read XHS session payload %s: %s", self.session_path, exc)
            return {}

        if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
            cookies = {
                str(cookie.get("name")): str(cookie.get("value"))
                for cookie in payload.get("cookies", [])
                if isinstance(cookie, dict) and cookie.get("name") and cookie.get("value")
            }
            return self._ensure_cli_cookie_requirements(cookies)

        if isinstance(payload, dict):
            cookies = {str(key): str(value) for key, value in payload.items() if value is not None}
            return self._ensure_cli_cookie_requirements(cookies)

        return {}

    def _ensure_cli_cookie_requirements(self, cookies: dict[str, str]) -> dict[str, str]:
        if cookies.get("a1"):
            return cookies

        seed = self._normalize_text(cookies.get("web_session") or cookies.get("id_token"))
        if not seed:
            return cookies

        # xiaohongshu-cli/xhshow signatures still require an a1 token. Some newer
        # web logins only surface web_session + id_token, so synthesize a stable
        # per-session fallback to keep signing and cookie headers aligned.
        cookies["a1"] = hashlib.sha1(f"syntrae-xhs-a1|{seed}".encode("utf-8")).hexdigest()
        logger.info("Synthesized fallback XHS a1 cookie from captured session payload")
        return cookies

    @staticmethod
    def _build_note_url(note_ref: str, note_id: str, xsec_token: str | None = None, xsec_source: str | None = None) -> str:
        base_ref = XiaohongshuPlatform._normalize_text(note_ref)
        if base_ref.startswith("http://") or base_ref.startswith("https://"):
            base_url = base_ref
        else:
            base_url = f"https://www.xiaohongshu.com/explore/{note_id}"

        token = XiaohongshuPlatform._normalize_text(xsec_token)
        if not token:
            return base_url

        source = XiaohongshuPlatform._normalize_text(xsec_source) or "search"
        if "xsec_token=" in base_url:
            return base_url
        return f"{base_url}?xsec_token={token}&xsec_source={source}"

    @staticmethod
    def _extract_note_id(note_ref: str) -> str:
        value = XiaohongshuPlatform._normalize_text(note_ref)
        if not value:
            return ""
        if value.startswith("http://") or value.startswith("https://"):
            marker = "/explore/"
            if marker in value:
                tail = value.split(marker, 1)[1]
                return tail.split("?", 1)[0].strip()
            return ""
        return value

    @staticmethod
    def _normalize_text(value):
        if value is None:
            return ""
        return str(value).strip()

    @staticmethod
    def _normalize_comment_id(value):
        text = XiaohongshuPlatform._normalize_text(value)
        if not text:
            return ""
        return f"xhs-cmt-{text}"

    @staticmethod
    def _normalize_comment_author_id(user):
        for key in ("user_id", "id", "uid"):
            value = XiaohongshuPlatform._normalize_text(user.get(key))
            if value:
                return value
        return "unknown"

    @staticmethod
    def _extract_comment_text(comment):
        for key in ("content", "text", "comment", "comment_text"):
            value = XiaohongshuPlatform._normalize_text(comment.get(key))
            if value:
                return value
        return ""

    @staticmethod
    def _extract_comment_user(comment):
        for key in ("user", "user_info", "userInfo", "author", "comment_user", "commentUser"):
            value = comment.get(key)
            if isinstance(value, dict):
                return value
        return {}

    @staticmethod
    def _extract_comment_author_name(comment, user):
        for source in (user, comment):
            for key in ("nickname", "name", "user_name", "userName", "nick_name", "author_name"):
                value = XiaohongshuPlatform._normalize_text(source.get(key))
                if value:
                    return value
        return ""

    @staticmethod
    def _extract_comment_author_id(comment, user):
        for key in ("user_id", "uid", "userId", "id", "author_id"):
            value = XiaohongshuPlatform._normalize_text(user.get(key))
            if value:
                return value

        for key in ("user_id", "uid", "userId", "author_id"):
            value = XiaohongshuPlatform._normalize_text(comment.get(key))
            if value:
                return value

        return "unknown"

    @staticmethod
    def _build_comment_id(comment, note_id, text, author_id):
        for key in ("comment_id", "commentId", "cid", "id"):
            value = XiaohongshuPlatform._normalize_text(comment.get(key))
            if value:
                return XiaohongshuPlatform._normalize_comment_id(value)

        ts = XiaohongshuPlatform._normalize_text(comment.get("create_time") or comment.get("time"))
        payload = f"{note_id}|{author_id}|{ts}|{text}"
        digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:20]
        return f"xhs-cmt-fb-{digest}"
