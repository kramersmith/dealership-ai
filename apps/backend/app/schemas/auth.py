from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    role: UserRole = UserRole.BUYER
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    role: UserRole


class UserResponse(BaseModel):
    id: str
    email: str
    role: UserRole
    display_name: str | None

    class Config:
        from_attributes = True
