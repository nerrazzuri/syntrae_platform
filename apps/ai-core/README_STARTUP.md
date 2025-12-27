# Backend Startup Instructions

## ✅ Current Status
The backend service is now running with your OpenAI API key properly configured!

- **Service URL**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/v1/health

## 🚀 How to Start the Backend

### Option 1: Quick Start (Recommended)
```powershell
cd D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend\src
python -m uvicorn ai_core.main:app --host 0.0.0.0 --port 8000
```

### Option 2: Using PowerShell Script
```powershell
cd D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend
.\run_backend.ps1
```

### Option 3: Using Batch File
```cmd
cd D:\Cursors\omnichannel_chatbot\omnichannel_chatbot\backend
start.bat
```

## 📝 Important Notes

1. **API Key**: Your OpenAI API key is stored in the `.env` file
   - Current key length: 164 characters (unusual but working)
   - The key has been tested and works with OpenAI's API

2. **Environment Variables**: The `.env` file must be in the backend directory
   - The service loads this file on startup
   - If you change the API key, restart the service

3. **Port 8000**: Make sure no other service is using port 8000
   - If port is in use, stop other services or change the port

## 🔧 Troubleshooting

### If the API key error persists:
1. **Stop all Python processes**:
   ```powershell
   Get-Process python* | Stop-Process -Force
   ```

2. **Check the API key in .env**:
   ```powershell
   Get-Content .env | Select-String "OPENAI_API_KEY"
   ```

3. **Restart with environment loaded**:
   ```powershell
   cd src
   $env:OPENAI_API_KEY = "your-api-key-here"
   python -m uvicorn ai_core.main:app --host 0.0.0.0 --port 8000
   ```

### If uploads still fail:
1. Make sure the backend was restarted after updating the API key
2. Check the backend console for error messages
3. Verify the API key works: `python ..\test_current_key.py`

## 📤 File Upload Endpoint

**URL**: `POST http://localhost:8000/v1/tenant/upload_file`

**Form Data**:
- `tenantId`: Valid UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`)
- `title`: Document title
- `file`: The file to upload (CSV, XLSX, TXT, PDF, etc.)
- `knowledgeBaseId`: (Optional) UUID or use `00000000-0000-0000-0000-000000000000`

## 🎯 Next Steps

1. Upload your employee data CSV/Excel files
2. Test queries like "What is the salary of [Employee Name]?"
3. The system should now return accurate results

## ⚠️ Security Reminder

- Never commit the `.env` file to version control
- Keep your API keys secure
- The `.gitignore` already excludes `.env` files