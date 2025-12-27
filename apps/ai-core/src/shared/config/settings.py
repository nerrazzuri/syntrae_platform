"""
Application configuration using Pydantic settings.
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    # Database
    database_url: str = Field(
        default="postgresql://user:password@localhost:5432/chatbot_dev",
        env="DATABASE_URL",
    )

    # Redis
    redis_url: str = Field(default="redis://localhost:6379/0", env="REDIS_URL")

    # AI Services
    openai_api_key: str = Field(default="", env="OPENAI_API_KEY")
    azure_openai_endpoint: Optional[str] = Field(
        default=None, env="AZURE_OPENAI_ENDPOINT"
    )
    azure_openai_key: Optional[str] = Field(default=None, env="AZURE_OPENAI_KEY")
    azure_openai_api_version: str = Field(
        default="2023-12-01-preview", env="AZURE_OPENAI_API_VERSION"
    )

    # Vector Database
    qdrant_url: str = Field(default="http://localhost:6333", env="QDRANT_URL")
    qdrant_api_key: Optional[str] = Field(default=None, env="QDRANT_API_KEY")

    # Authentication
    jwt_secret: str = Field(
        default="your-jwt-secret-key-minimum-32-characters", env="JWT_SECRET"
    )
    jwt_expires_minutes: int = Field(default=60, env="JWT_EXPIRES_MINUTES")

    # External Services
    whatsapp_verify_token: str = Field(default="", env="WHATSAPP_VERIFY_TOKEN")
    whatsapp_access_token: str = Field(default="", env="WHATSAPP_ACCESS_TOKEN")

    # Microsoft Teams
    teams_app_id: str = Field(default="", env="TEAMS_APP_ID")
    teams_app_secret: str = Field(default="", env="TEAMS_APP_SECRET")

    # Telegram
    telegram_bot_token: str = Field(default="", env="TELEGRAM_BOT_TOKEN")

    # WeChat
    wechat_app_id: str = Field(default="", env="WECHAT_APP_ID")
    wechat_app_secret: str = Field(default="", env="WECHAT_APP_SECRET")

    # LINE
    line_channel_access_token: str = Field(default="", env="LINE_CHANNEL_ACCESS_TOKEN")
    line_channel_secret: str = Field(default="", env="LINE_CHANNEL_SECRET")

    # Monitoring
    sentry_dsn: Optional[str] = Field(default=None, env="SENTRY_DSN")

    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    structured_logging: bool = Field(default=True, env="STRUCTURED_LOGGING")

    # Development
    debug: bool = Field(default=True, env="DEBUG")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


# Global settings instance
settings = Settings()
