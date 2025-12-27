import os
import shutil
import logging
from typing import Optional, BinaryIO
from pathlib import Path

logger = logging.getLogger(__name__)

class SecurityError(Exception):
    """Raised when a security violation is detected."""
    pass

class ArtifactStore:
    """
    Secure abstraction for file storage.
    Enforces containment within a root directory and strict tenant/video isolation.
    """
    def __init__(self, root_dir: str):
        self._root = os.path.realpath(root_dir)
        if not os.path.exists(self._root):
            os.makedirs(self._root, exist_ok=True)
            
    def _validate_path(self, relative_path: str) -> str:
        """
        Resolves path and ensures it is within root.
        Rejects traversal (..) and absolute paths attempting escape.
        """
        # Join root with relative path
        # os.path.join handles absolute second arg by discarding first, so we MUST ensure relative first.
        if os.path.isabs(relative_path):
            raise SecurityError(f"Trapped attempt to use absolute path: {relative_path}")
            
        full_path = os.path.realpath(os.path.join(self._root, relative_path))
        
        # Check if resolved path starts with root
        if not full_path.startswith(self._root):
            raise SecurityError(f"Path traversal detected. {relative_path} resolves to {full_path} which is outside {self._root}")
            
        return full_path

    def get_video_dir(self, tenant_id: str, video_id: str) -> str:
        """
        Returns the safe absolute path for a video's artifact directory.
        Criteria: <root>/<tenant_id>/<video_id>
        """
        # Basic sanitization of IDs to prevent directory injection
        if ".." in tenant_id or "/" in tenant_id or "\\" in tenant_id:
             raise SecurityError(f"Invalid tenant_id: {tenant_id}")
        if ".." in video_id or "/" in video_id or "\\" in video_id:
             raise SecurityError(f"Invalid video_id: {video_id}")
             
        rel_path = os.path.join(tenant_id, video_id)
        return self._validate_path(rel_path)

    def save_file(self, tenant_id: str, video_id: str, filename: str, content: BinaryIO) -> str:
        """
        Saves a file safely. Returns absolute path.
        """
        if ".." in filename or "/" in filename or "\\" in filename:
             raise SecurityError(f"Invalid filename: {filename}")
             
        base_dir = self.get_video_dir(tenant_id, video_id)
        if not os.path.exists(base_dir):
            os.makedirs(base_dir, exist_ok=True)
            
        full_path = self._validate_path(os.path.join(base_dir, filename))
        
        with open(full_path, "wb") as f:
            shutil.copyfileobj(content, f)
            
        return full_path

    def get_path(self, tenant_id: str, video_id: str, filename: str) -> str:
        """
        Resolves safe path for reading.
        """
        base_dir = self.get_video_dir(tenant_id, video_id)
        return self._validate_path(os.path.join(base_dir, filename))
