from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수(.env)에서 읽는 설정입니다."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "{{name}}"
    database_url: str = "sqlite:///./data/app.db"
    cors_origins: str = "http://localhost:3000"


settings = Settings()
