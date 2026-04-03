import speech_recognition as sr
import logging
from typing import List
from video_engine.core.schemas import AudioTranscript, AudioSegment

logger = logging.getLogger(__name__)

class AsrService:
    def __init__(self, timeout: int = 30):
        self.recognizer = sr.Recognizer()
        self.timeout = timeout

    def transcribe(self, audio_path: str) -> AudioTranscript:
        """
        Transcribes a .wav file.
        """
        if not audio_path:
            return AudioTranscript(language="unknown", segments=[])

        try:
            with sr.AudioFile(audio_path) as source:
                # Record the audio
                audio_data = self.recognizer.record(source)
                
                # Recognize (Google Web Speech API)
                # Note: This is a network call.
                text = self.recognizer.recognize_google(audio_data)
                
                # Since simple Google API doesn't give segments, we create one segment
                # covering the presumed duration or just 0.0-END
                # To get duration we can use the source duration
                duration = source.DURATION if hasattr(source, 'DURATION') else 0.0
                
                return AudioTranscript(
                    language="en-US", # Auto-detected implicit in Google API, usually returns English unless specified
                    segments=[
                        AudioSegment(start=0.0, end=duration, text=text)
                    ]
                )

        except sr.UnknownValueError:
            logger.warning("ASR could not understand audio")
            return AudioTranscript(language="unknown", segments=[])
        except sr.RequestError as e:
            logger.error(f"ASR service error: {e}")
            return AudioTranscript(language="error", segments=[])
        except Exception as e:
            logger.error(f"ASR processing failed: {e}")
            return AudioTranscript(language="error", segments=[])
