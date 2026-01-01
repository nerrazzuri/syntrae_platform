
import asyncio
import logging
import random
import time
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

from datetime import datetime
import pytz

class PolicyEnforcer:
    """
    Enforces Automation Policies (Rate Limits, Pacing, Gates).
    Maintains local state for the current run.
    """
    def __init__(self, policy: Dict[str, Any]):
        self.policy = policy
        self.enabled = policy.get("enabled", False)
        self.mode = policy.get("mode", "SAFE")
        
        # Limits
        self.max_videos_ph = policy.get("max_videos_per_hour", 20)
        self.max_comments_pv = policy.get("max_comments_per_video", 30)
        self.max_comments_ph = policy.get("max_comments_per_hour", 200)
        self.cooldown_ms = policy.get("cooldown_ms_between_actions", 2500)
        self.jitter_ms = policy.get("random_jitter_ms", 1500)
        
        # Quiet Hours
        self.quiet_hours = policy.get("quiet_hours", {})
        
        # State
        self.videos_processed = 0
        self.comments_processed = 0
        self.start_time = time.time()
        
    def check_quiet_hours(self) -> bool:
        """
        Checks if current time is within quiet hours window.
        Returns True if in quiet hours (SHOULD STOP).
        """
        if not self.quiet_hours:
            return False
            
        tz_name = self.quiet_hours.get("timezone")
        start_str = self.quiet_hours.get("start")
        end_str = self.quiet_hours.get("end")
        
        if not tz_name or not start_str or not end_str:
            return False
            
        try:
            tz = pytz.timezone(tz_name)
            now = datetime.now(tz)
            current_time = now.time()
            
            # Simple HH:MM parsing
            start_h, start_m = map(int, start_str.split(':'))
            end_h, end_m = map(int, end_str.split(':'))
            
            start_time = current_time.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
            end_time = current_time.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
            
            # Helper to compare
            if start_time < end_time:
                # Same day window (e.g. 01:00 to 07:00)
                is_quiet = start_time <= current_time < end_time
            else:
                # Overnight window (e.g. 23:00 to 06:00)
                is_quiet = current_time >= start_time or current_time < end_time
                
            if is_quiet:
                 logger.warning(f"🌙 Quiet Hours Active ({start_str}-{end_str} {tz_name}). Aborting.")
                 return True
                 
            return False
        except Exception as e:
            logger.error(f"Quiet Hours check error: {e}")
            return False # Fail open or closed? Using open (allow run) to avoid accidental blocks on config error.

    def check_run_gate(self) -> bool:
        """Checks if the run should proceed based on global status."""
        if not self.enabled:
            logger.warning("🚫 Policy DISABLED. Aborting Run.")
            return False
            
        if self.policy.get("status") != "ACTIVE":
             logger.warning(f"🚫 Policy status {self.policy.get('status')} (Not ACTIVE). Aborting.")
             return False
             
        if self.check_quiet_hours():
            return False
             
        return True

    def check_video_limit_gate(self) -> bool:
        """Checks if video limit for this hour/run reached."""
        if self.videos_processed >= self.max_videos_ph:
            logger.warning(f"🛑 Max videos limit ({self.max_videos_ph}) reached.")
            return False
        return True
        
    def check_comment_limit_gate(self, current_video_comments: int) -> bool:
        """Checks per-video comment limit."""
        if current_video_comments >= self.max_comments_pv:
            return False
        if self.comments_processed >= self.max_comments_ph:
            logger.warning(f"🛑 Max hourly comments limit ({self.max_comments_ph}) reached.")
            return False
        return True
    
    async def pace_action(self, action_name: str = "action"):
        """Sleeps for cooldown + jitter."""
        sleep_ms = self.cooldown_ms + random.randint(0, self.jitter_ms)
        sleep_sec = sleep_ms / 1000.0
        logger.debug(f"⏳ Pacing ({action_name}): sleeping {sleep_sec:.2f}s")
        await asyncio.sleep(sleep_sec)

    def track_video(self):
        self.videos_processed += 1
        
    def track_comment(self):
        self.comments_processed += 1

    def get_relevance_threshold(self) -> int:
        return self.policy.get("relevance_min_score", 70)
