from __future__ import annotations


class AppError(Exception):
    status_code = 500

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(AppError):
    status_code = 404


class ValidationError(AppError):
    status_code = 400


class DeviceCommunicationError(AppError):
    status_code = 502


class DatabaseError(AppError):
    status_code = 500
