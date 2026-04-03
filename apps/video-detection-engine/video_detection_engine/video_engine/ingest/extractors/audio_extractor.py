import os
import uuid
import logging
from typing import Optional
from moviepy import VideoFileClip

logger = logging.getLogger(__name__)

class AudioExtractor:
    def __init__(self, storage_root: str):
        self.storage_root = storage_root
        if not os.path.exists(storage_root):
            os.makedirs(storage_root)

    def extract(self, video_path: str) -> Optional[str]:
        """
        Extracts audio from video and saves as .wav.
        Returns path to .wav or None if no audio.
        """
        try:
            # Load video
            clip = VideoFileClip(video_path)
            if clip.audio is None:
                logger.warning(f"No audio track found in {video_path}")
                clip.close()
                return None
            
            # Generate path
            audio_id = str(uuid.uuid4())
            save_path = os.path.join(self.storage_root, f"{audio_id}.wav")
            
            # Write audio
            # logger=None surresses moviepy's standard output
            clip.audio.write_audiofile(save_path, codec='pcm_s16le', logger=None)
            
            clip.close()
            return save_path

        except Exception as e:
            logger.error(f"Failed to extract audio: {e}")
            return None
