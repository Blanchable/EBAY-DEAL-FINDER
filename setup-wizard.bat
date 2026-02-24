@echo off
setlocal ENABLEDELAYEDEXPANSION

cd /d "%~dp0"

set "REPO_PATH=%CD%"
if not "%REPO_PATH:~90,1%"=="" (
  echo WARNING: Your folder path is very long.
  echo Consider moving this repo to a short path like C:\bot\ebay
  echo.
)

echo =============================================
echo eBay Deal Finder - One-Click Wizard Setup
echo =============================================

echo [1/6] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed. Install Node 20+ and rerun.
  pause
  exit /b 1
)

echo [2/6] Checking pnpm...
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

echo [3/6] Ensuring .env exists...
if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo Created .env from .env.example
  ) else (
    echo WARNING: .env.example not found. Continuing...
  )
)

echo [4/6] Installing dependencies...
call pnpm i
if errorlevel 1 goto :fail

echo [5/6] Running migrations + prisma generate...
call pnpm db:migrate
if errorlevel 1 goto :fail
call pnpm prisma:generate
if errorlevel 1 goto :fail

echo [6/6] Launching local control center GUI...
call pnpm wizard:local
if errorlevel 1 goto :fail

goto :eof

:fail
echo.
echo Setup failed. Check the logs above.
pause
exit /b 1
