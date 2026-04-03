import logging
import subprocess
import json as json_lib
import hashlib
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class XiaohongshuPlatform:
    """
    Phase-2 Xiaohongshu Discovery Adapter.
    
    Strategy: Uses the external `xiaohongshu-cli` directly for search and comment extraction,
    completely bypassing brittle in-browser React scraping.
    """
    async def run_search(self, browser_page, keyword, is_video_eligible=None):
        # We ignore browser_page completely since we use the CLI
        logger.info(f"Starting Xiaohongshu Discovery via CLI for keyword: {keyword}")
        
        # 2. Perform search via CLI
        logger.info("Executing xhs search CLI...")
        posts = []
        seen_note_ids = set()
        try:
            res = subprocess.run(["xhs", "search", keyword, "--json"], capture_output=True, text=True, timeout=30)
            if res.returncode == 0:
                data = json_lib.loads(res.stdout)
                if data.get("ok") and "data" in data and "items" in data["data"]:
                    for item in data["data"]["items"]:
                        note_card = item.get("note_card", {})
                        note_id = item.get("id", note_card.get("note_id", ""))
                        if not note_id or note_id in seen_note_ids:
                            continue
                        seen_note_ids.add(note_id)
                        posts.append({
                            "note_id": note_id,
                            "title": note_card.get("display_title", keyword),
                            "author": note_card.get("user", {}).get("nickname", "unknown"),
                            "like_count": int(note_card.get("interact_info", {}).get("liked_count", 0)),
                        })
                else:
                    logger.error(f"XHS CLI search error: {data.get('error', {}).get('message', 'Unknown error')}")
            else:
                logger.error(f"XHS CLI search failed: {res.stderr}")
        except Exception as e:
            logger.error(f"Failed to execute xhs search CLI: {e}")
            
        if not posts:
            logger.warning(
                "No search results found for keyword: %s. If session expired, refresh the scoped session under /data/storage/sessions/<workspace>/<brand>/rednote/session.json.",
                keyword
            )
            return []
            
        logger.info(f"Extracted {len(posts)} posts from search results via CLI")

        # 3. Fetch real comments
        final_events = []
        for post in posts[:20]: # Limit to 20
            note_id = post["note_id"]
            post_url = f"https://www.xiaohongshu.com/explore/{note_id}"
            post_author = self._normalize_text(post["author"])

            if is_video_eligible:
                eligibility = await is_video_eligible(note_id)
                if not eligibility.get("eligible", True):
                    logger.info(
                        "Skipping XHS note %s due to cooldown until %s",
                        note_id,
                        eligibility.get("cooldown_until")
                    )
                    continue
            
            # Base event object
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
            }
            
            logger.info(f"Fetching real comments for video {note_id} using xhs-cli...")
            real_comments = []
            try:
                # xhs comments <note_id> --json
                res = subprocess.run(["xhs", "comments", note_id, "--json"], capture_output=True, text=True, timeout=15)
                if res.returncode == 0:
                    try:
                        data = json_lib.loads(res.stdout)
                        if data.get("ok") and "data" in data and "comments" in data["data"]:
                            for c in data["data"]["comments"]:
                                real_comments.append(c)
                                if len(real_comments) >= 10:
                                    break
                    except json_lib.JSONDecodeError:
                        logger.warning(f"Failed to parse xhs-cli JSON for {note_id}")
                else:
                    logger.warning(f"xhs-cli failed for {note_id}: {res.stderr}")
            except Exception as e:
                logger.error(f"Failed to fetch comments via xhs-cli: {e}")
                
            if not real_comments:
                logger.info(f"No real comments found for {note_id}; skipping emission")
                continue

            logger.info(f"Successfully fetched {len(real_comments)} real comments for {note_id}")
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
                    logger.info(f"Skipping self-authored XHS comment {comment_id} on note {note_id}")
                    continue

                event = base_event.copy()
                event["content_text"] = raw_text
                event["comment_author_name"] = comment_author or "unknown"
                event["comment_author_id"] = comment_author_id
                event["like_count"] = int(cmt.get("like_count", 0))
                event["referral_comment_id"] = comment_id
                final_events.append(event)
                    
        return final_events

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
