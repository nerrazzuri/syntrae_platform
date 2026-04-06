import hashlib
import json as json_lib
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from xhs_cli.client import XhsClient
from xhs_cli.exceptions import XhsApiError

logger = logging.getLogger(__name__)


class XiaohongshuPlatform:
    DEFAULT_POSTS_PER_KEYWORD = 20
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
        seen_note_ids = set()
        try:
            with XhsClient(cookies) as client:
                data = client.search_notes(keyword)
                items = data.get("items", []) if isinstance(data, dict) else []
                for item in items:
                    note_card = item.get("note_card", {})
                    note_ref = self._normalize_text(item.get("id", note_card.get("note_id", "")))
                    note_id = self._extract_note_id(note_ref)
                    if not note_id or note_id in seen_note_ids:
                        continue
                    seen_note_ids.add(note_id)
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
                    caption = self._normalize_text(
                        note_card.get("display_title")
                        or note_card.get("title")
                        or note_card.get("desc")
                        or keyword
                    )
                    hashtags = self._extract_hashtags(caption, note_card.get("desc"), note_card.get("tag_list"))
                    posts.append({
                        "note_id": note_id,
                        "note_ref": note_ref,
                        "title": caption,
                        "hashtags": hashtags,
                        "author": note_card.get("user", {}).get("nickname", "unknown"),
                        "like_count": int(note_card.get("interact_info", {}).get("liked_count", 0)),
                        "xsec_token": xsec_token,
                        "xsec_source": xsec_source,
                    })
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
                "hashtags": post.get("hashtags") or [],
                "search_keyword": keyword,
                "page_url": post_url,
                "page_timestamp": now,
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
                    real_comments.extend(comments[:comments_limit])
            except XhsApiError as exc:
                logger.warning("XHS comments failed for %s: %s", note_id, exc)
            except Exception as exc:
                logger.error("Failed to fetch comments via XHS client: %s", exc)

            if not real_comments:
                logger.info("No real comments found for %s; skipping emission", note_id)
                continue

            logger.info("Successfully fetched %s real comments for %s", len(real_comments), note_id)
            seen_comment_ids = set()
            for cmt in real_comments:
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
                final_events.append(event)

        return {
            "events": final_events,
            "source_posts_processed": len(processed_note_ids),
        }

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
    def _extract_hashtags(*values):
        tags = []

        for value in values:
            if not value:
                continue
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        tags.append(XiaohongshuPlatform._normalize_text(
                            item.get("name") or item.get("tag_name") or item.get("tagName") or item.get("title")
                        ))
                    else:
                        tags.append(XiaohongshuPlatform._normalize_text(item))
                continue

            text = XiaohongshuPlatform._normalize_text(value)
            tags.extend(re.findall(r"#([\w\u4e00-\u9fff-]+)", text))

        normalized = []
        seen = set()
        for tag in tags:
            clean = XiaohongshuPlatform._normalize_text(tag).lstrip("#")
            if not clean:
                continue
            key = clean.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(clean)

        return normalized[:12]

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
