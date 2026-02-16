from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    icv6_host: str = "10.0.2.116"
    icv6_port: int = 80
    icv6_device_id: str = "R5S2A000188"
    database_path: str = "./portal.db"
    validation_interval_seconds: int = 60


settings = Settings()
