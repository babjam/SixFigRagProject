@echo off
title Six Figure RAG - Launcher

echo ===================================================
echo 🧹 CLEANUP PHASE: Liberating ports...
echo ===================================================

:: 1. Kill Node.js (Frees Port 3000)
echo 🔫 Killing lingering Node.js processes...
taskkill /F /IM node.exe >nul 2>&1

:: 2. Kill Python (Frees Port 8000)
echo 🔫 Killing lingering Python processes...
taskkill /F /IM python.exe >nul 2>&1

:: 3. Stop Supabase (Frees Port 54321-54323)
echo 🛑 Stopping Supabase containers...
call npx supabase stop --no-backup

:: NOTE: We do NOT stop Redis here. This prevents the "Double Password" issue.

echo.
echo ===================================================
echo 🚀 LAUNCH PHASE: Starting fresh session...
echo ===================================================

:: --- STEP 0: DOCKER CHECK ---
echo Checking Docker status...
docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker Engine is running.
) else (
    echo 🐳 Docker is sleeping. Launching Desktop App...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    
    echo ⏳ Waiting for Docker to wake up (this takes a moment)...
    :WaitForDocker
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% neq 0 goto WaitForDocker
    echo ✅ Docker is ready!
)

:: --- STEP 1: START SUPABASE ---
echo 1. Starting Local Supabase...
:: 'call' ensures we wait for it to finish starting before moving on
call npx supabase start

:: --- STEP 2: START REDIS (WSL) ---
echo 2. Starting Redis Server (WSL)...
:: This is the ONLY time you will type your password
start "2-Redis-Database" cmd /k "wsl sudo service redis-server start && echo ✅ Redis is Running! && wsl redis-cli ping"

:: --- STEP 3: START BACKEND ---
echo 3. Starting FastAPI Backend...
start "3-Backend-API" cmd /k "cd server && poetry run uvicorn src.server:app --reload"

:: --- STEP 4: START WORKER ---
echo 4. Starting Celery Worker...
start "4-Celery-Worker" cmd /k "cd server && poetry run celery -A tasks.celery_app worker --loglevel=info --pool=solo"

:: --- STEP 5: START FRONTEND ---
echo 5. Starting Frontend Client...
start "5-Frontend-Client" cmd /k "cd client && npm run dev"

echo ===================================================
echo ✅ All systems are Go!
echo ===================================================
pause