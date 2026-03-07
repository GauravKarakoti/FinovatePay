@echo off
echo Setting up environment files...

REM Copy root .env.example to .env if it doesn't exist
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo ✓ Created .env from .env.example
    ) else (
        echo ⚠ Warning: .env.example not found in root directory
    )
)

REM Copy backend .env.example to .env if it doesn't exist
if not exist backend\.env (
    if exist backend\.env.example (
        copy backend\.env.example backend\.env >nul
        echo ✓ Created backend/.env from backend/.env.example
    ) else (
        echo ⚠ Warning: backend/.env.example not found
    )
)

REM Copy frontend .env.example to .env if it doesn't exist
if not exist frontend\.env (
    if exist frontend\.env.example (
        copy frontend\.env.example frontend\.env >nul
        echo ✓ Created frontend/.env from frontend/.env.example
    ) else (
        echo ⚠ Warning: frontend/.env.example not found
    )
)

echo.
echo Environment setup complete!
echo Please review and update the .env files with your specific configuration values.
echo.
echo To start the application:
echo   docker compose up --build
pause