@echo off
REM Dev mode launcher: Vite dev server + Electron + FastAPI subprocess.
REM Console stays open so you can see logs (FastAPI errors, Vite warnings,
REM [updater] / [fastapi] traces). Ctrl+C to stop.

chcp 65001 >nul
setlocal

REM cd to project root regardless of where this .bat was invoked from.
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo.
  echo ERROR: .venv\Scripts\python.exe khong thay.
  echo Chay 'uv sync' tai project root truoc.
  echo.
  pause
  exit /b 1
)

if not exist "electron\package.json" (
  echo.
  echo ERROR: electron\package.json khong thay tai "%cd%".
  echo Hay dat dev.bat tai repo root cua Baru-Pixelle.
  echo.
  pause
  exit /b 1
)

echo.
echo === Baru-Pixelle dev mode ===

REM Cleanup orphans from a previous crashed run. Common cause of
REM "backend down": last session left python.exe holding port 5000,
REM new uvicorn fails to bind, Electron renders with no FastAPI.
echo Don process cu...
taskkill /F /IM electron.exe >nul 2>&1
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr ":5000 " ^| findstr LISTENING') do (
  taskkill /F /PID %%P >nul 2>&1
)

echo Vite:    http://localhost:5173
echo FastAPI: http://localhost:5000  ^(Swagger at /docs^)
echo Ctrl+C de tat.
echo.

set "BARU_PYTHON=%cd%\.venv\Scripts\python.exe"

cd electron
call npm run dev

REM If npm exited with an error (missing node_modules, ...), keep window
REM open so user can read the message instead of it flashing closed.
if errorlevel 1 (
    echo.
    echo === LOI: npm run dev ket thuc voi error code %errorlevel% ===
    pause
)
