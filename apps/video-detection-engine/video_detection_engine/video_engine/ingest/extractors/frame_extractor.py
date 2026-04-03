import cv2
import os
import uuid
import logging
from typing import List, Tuple
from video_engine.core.schemas import FrameArtifact

logger = logging.getLogger(__name__)

class FrameExtractor:
    def __init__(self, storage_root: str, fps: float = 1.0, max_frames: int = 60, max_dimension: int = 720):
        self.storage_root = storage_root
        self.fps = fps
        self.max_frames = max_frames
        self.max_dimension = max_dimension
        
        if not os.path.exists(storage_root):
            os.makedirs(storage_root)

    def extract(self, video_path: str) -> List[FrameArtifact]:
        """
        Extracts frames from video, saves to disk, returns artifacts.
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
             raise ValueError(f"Could not open video: {video_path}")

        video_fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / video_fps if video_fps > 0 else 0
        
        # Interval for sampling
        interval = int(video_fps / self.fps) if self.fps > 0 else int(video_fps)
        if interval < 1: interval = 1

        artifacts = []
        frame_count = 0
        saved_count = 0
        
        while cap.isOpened() and saved_count < self.max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_count % interval == 0:
                # Resize if needed
                h, w = frame.shape[:2]
                scale = 1.0
                if max(h, w) > self.max_dimension:
                    scale = self.max_dimension / max(h, w)
                    new_w, new_h = int(w * scale), int(h * scale)
                    frame = cv2.resize(frame, (new_w, new_h))
                else:
                    new_w, new_h = w, h
                
                # Save
                frame_id = str(uuid.uuid4())
                filename = f"{frame_id}.jpg"
                save_path = os.path.join(self.storage_root, filename)
                
                cv2.imwrite(save_path, frame)
                
                timestamp = frame_count / video_fps if video_fps > 0 else 0.0
                
                artifacts.append(FrameArtifact(
                    frame_id=frame_id,
                    timestamp=round(timestamp, 2),
                    storage_path=save_path,
                    width=new_w,
                    height=new_h,
                    format="jpg"
                ))
                saved_count += 1
            
            frame_count += 1

        cap.release()
        logger.info(f"Extracted {saved_count} frames from {video_path}")
        return artifacts
