@echo off
echo =========================================
echo Starting Omnichannel Chatbot Backend
echo =========================================
echo.

REM Load Python from default installation
cd /d "D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend"

REM Set Python path
set PYTHONPATH=D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend\src

REM Load .env file variables
echo Loading environment variables...
for /f "delims=" %%x in (.env) do (
    echo %%x | findstr /r "^[^#]" >nul && set "%%x"
)

echo.
echo Starting server on http://localhost:8000
echo Press Ctrl+C to stop
echo =========================================
echo.

REM Change to src directory and start server
cd src
python -m uvicorn ai_core.main:app --host 0.0.0.0 --port 8000 --reload