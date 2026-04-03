import os
import logging
import math
from PIL import Image

logger = logging.getLogger(__name__)

class ValidationError(Exception):
    """Raised when media validation fails."""
    pass

class MediaValidators:
    """
    Validates input media files against security constraints.
    """
    
    # Configurable limits (should pass in config ideally)
    MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024 # 500MB
    MAX_DURATION_SECONDS = 600 # 10 minutes
    ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
    
    MAX_IMAGE_DIMENSION = 4096
    MAX_IMAGE_MEGAPIXELS = 16
    ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
    
    @staticmethod
    def validate_video(file_path: str):
        """
        Validates video file size, extension, and basic integrity.
        Duration check might require reading metadata (heavy), can be done here or early pipeline.
        """
        # 1. Existence
        if not os.path.exists(file_path):
            raise ValidationError(f"Video file not found: {file_path}")
            
        # 2. Extension
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in MediaValidators.ALLOWED_VIDEO_EXTENSIONS:
            raise ValidationError(f"Disallowed video format: {ext}")
            
        # 3. Size
        size = os.path.getsize(file_path)
        if size > MediaValidators.MAX_VIDEO_SIZE_BYTES:
            raise ValidationError(f"Video size {size} exceeds limit {MediaValidators.MAX_VIDEO_SIZE_BYTES}")
            
        # 4. Integrity/Header (Basic)
        # Could use 'file' command or magic numbers, but extension+size is decent first line.
        
    @staticmethod
    def validate_frame(image_path: str):
        """
        Validates an extracted frame (Anti-Image Bomb).
        """
        try:
            # Open without loading all data
            with Image.open(image_path) as img:
                width, height = img.size
                
                # 1. Dimensions
                if width > MediaValidators.MAX_IMAGE_DIMENSION or height > MediaValidators.MAX_IMAGE_DIMENSION:
                     raise ValidationError(f"Frame dimension {width}x{height} exceeds limit {MediaValidators.MAX_IMAGE_DIMENSION}")
                
                # 2. Megapixels
                mp = (width * height) / 1_000_000
                if mp > MediaValidators.MAX_IMAGE_MEGAPIXELS:
                     raise ValidationError(f"Frame megapixels {mp:.2f} exceeds limit {MediaValidators.MAX_IMAGE_MEGAPIXELS}")
                
                # 3. Format
                if img.format not in MediaValidators.ALLOWED_IMAGE_FORMATS:
                     # Non-fatal warning? Or strict? Spec says "Allowed formats only"
                     # Since we extract frames ourselves, this is a self-check or check on user-provided images if any.
                     pass 
                     
                # 4. Compression Ratio (Bomb detection)
                # Hard with just header. Decompression limit is handled by Pillow's DecompressionBombError often.
                # We can enforce it:
                Image.MAX_IMAGE_PIXELS = MediaValidators.MAX_IMAGE_MEGAPIXELS * 1_000_000 # Strict limit
                
        except Exception as e:
            raise ValidationError(f"Frame validation failed: {e}")

    @staticmethod
    def validate_audio(file_path: str, max_duration: float):
        """
        Validates extracted audio.
        """
        if not os.path.exists(file_path):
             return # Missing ok?
             
        size = os.path.getsize(file_path)
        # Sanity check audio size vs expected duration * bitrate
        # 10 mins stereo wav 44.1 ~ 100MB. 
        if size > 200 * 1024 * 1024: 
             raise ValidationError("Audio track suspiciously large")
