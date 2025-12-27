# PowerShell script to start the backend service with proper environment

Write-Host '=========================================' -ForegroundColor Cyan
Write-Host 'Starting Omnichannel Chatbot Backend' -ForegroundColor Cyan
Write-Host '=========================================' -ForegroundColor Cyan

# Set the working directory
Set-Location "D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend"

# Load environment variables from .env file
if (Test-Path '.env') {
    Write-Host ''
    Write-Host 'Loading environment from .env file...' -ForegroundColor Yellow
    
    Get-Content .env | ForEach-Object {
        if ($_ -match '^[^#].+=.+$') {
            $parts = $_ -split '=', 2
            $name = $parts[0].Trim()
            $value = $parts[1].Trim()
            
            # Set the environment variable
            [System.Environment]::SetEnvironmentVariable($name, $value, [System.EnvironmentVariableTarget]::Process)
            
            # Show loaded variables (mask sensitive ones)
            if ($name -eq 'OPENAI_API_KEY') {
                if ($value.Length -gt 20) {
                    $masked = $value.Substring(0, 15) + '...' + $value.Substring($value.Length - 4)
                    Write-Host ("  Loaded {0} : {1} (Length: {2})" -f $name, $masked, $value.Length) -ForegroundColor Green
                } else {
                    Write-Host ("  Loaded {0}" -f $name) -ForegroundColor Green
                }
            } elseif ($name -like '*SECRET*' -or $name -like '*TOKEN*' -or $name -like '*PASSWORD*') {
                Write-Host ("  Loaded {0} : [HIDDEN]" -f $name) -ForegroundColor Green
            } else {
                Write-Host ("  Loaded {0} : {1}" -f $name, $value) -ForegroundColor Green
            }
        }
    }
    
    # Verify the API key is set
    $apiKey = [System.Environment]::GetEnvironmentVariable('OPENAI_API_KEY')
    if ($apiKey) {
        Write-Host ''
        Write-Host ("OpenAI API Key is configured (Length: {0} characters)" -f $apiKey.Length) -ForegroundColor Green
    } else {
        Write-Host ''
        Write-Host 'WARNING: OpenAI API Key not found!' -ForegroundColor Red
    }
} else {
    Write-Host ''
    Write-Host 'ERROR: .env file not found!' -ForegroundColor Red
    Write-Host '  Please create a .env file with your configuration' -ForegroundColor Yellow
    exit 1
}

# Set Python path to include src directory
$env:PYTHONPATH = 'D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend\src'
Write-Host ''
Write-Host ("Python path set to: {0}" -f $env:PYTHONPATH) -ForegroundColor Cyan

# Change to src directory for proper module resolution
Set-Location 'src'

Write-Host ''
Write-Host '=========================================' -ForegroundColor Cyan
Write-Host 'Starting server on http://localhost:8000' -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop' -ForegroundColor Yellow
Write-Host '=========================================' -ForegroundColor Cyan
Write-Host ''

# Start the backend service
python -m uvicorn ai_core.main:app --host 0.0.0.0 --port 8000 --reload