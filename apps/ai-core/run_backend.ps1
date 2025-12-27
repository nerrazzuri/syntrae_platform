# Comprehensive startup script for backend service

# Navigate to backend directory
Set-Location "D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Omnichannel Chatbot Backend Startup" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Kill any existing Python processes
Write-Host "`nStopping any existing backend processes..." -ForegroundColor Yellow
Get-Process python* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Load environment variables from .env
Write-Host "`nLoading environment from .env..." -ForegroundColor Yellow

if (Test-Path ".env") {
    $envVars = @{}
    Get-Content .env | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.+)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            $envVars[$name] = $value
            
            # Set in current process
            [System.Environment]::SetEnvironmentVariable($name, $value, [System.EnvironmentVariableTarget]::Process)
            
            if ($name -eq "OPENAI_API_KEY") {
                $masked = $value.Substring(0, 15) + "..." + $value.Substring($value.Length - 4)
                Write-Host "  ✓ $name loaded: $masked (Length: $($value.Length))" -ForegroundColor Green
            }
        }
    }
    
    # Export variables for child process
    $env:OPENAI_API_KEY = $envVars["OPENAI_API_KEY"]
    $env:DATABASE_URL = $envVars["DATABASE_URL"]
    $env:REDIS_URL = $envVars["REDIS_URL"]
    $env:QDRANT_URL = $envVars["QDRANT_URL"]
    $env:JWT_SECRET = $envVars["JWT_SECRET"]
    $env:LOG_LEVEL = $envVars["LOG_LEVEL"]
    $env:DEBUG = $envVars["DEBUG"]
} else {
    Write-Host "❌ .env file not found!" -ForegroundColor Red
    exit 1
}

# Set Python path
$env:PYTHONPATH = "D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend\src"
Write-Host "`nPYTHONPATH set to: $env:PYTHONPATH" -ForegroundColor Cyan

# Change to src directory
Set-Location "src"

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "Starting server on http://localhost:8000" -ForegroundColor Green
Write-Host "API Docs: http://localhost:8000/docs" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Start the server
python -m uvicorn ai_core.main:app --host 0.0.0.0 --port 8000 --reload