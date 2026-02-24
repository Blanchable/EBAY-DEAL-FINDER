@echo off
setlocal ENABLEDELAYEDEXPANSION

cd /d "%~dp0"

echo =============================================
echo eBay Deal Finder - One-Click Wizard Setup
echo =============================================

echo [1/7] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed. Install Node 20+ and rerun.
  pause
  exit /b 1
)

echo [2/7] Checking pnpm...
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm not found. Trying Corepack...
  call corepack enable
  call corepack prepare pnpm@9.12.0 --activate
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm is still not available.
  echo Install it with: npm i -g pnpm@9.12.0
  pause
  exit /b 1
)

echo [3/7] Ensuring .env exists...
if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo Created .env from .env.example
  ) else (
    echo WARNING: .env.example not found. Continuing...
  )
)

echo [4/7] Installing dependencies...
call pnpm i
if errorlevel 1 goto :fail

echo [5/7] Running database migrations...
call pnpm db:migrate
if errorlevel 1 goto :fail

echo [6/7] Typechecking...
call pnpm typecheck
if errorlevel 1 goto :fail

echo [7/7] Launching wizard UI...
start "" "http://localhost:4311"
call pnpm wizard:start
if errorlevel 1 goto :fail

goto :eof

:fail
echo.
echo Setup failed. Check the logs above.
pause
exit /b 1
