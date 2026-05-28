# Gemini Local CLI - Express REST API Documentation

This tool automatically launches a local Express API Server in the background when your session starts (if enabled in settings). The server provides a simple REST API to route requests to your active background Gemini browser tab from external scripts, programs, or automation tools.

---

## Configuration & Port

- Default Port: 8000 (can be changed using the /settings command in the TUI).
- Request Address: POST http://localhost:8000/ask
- Server Toggle: The API server can be completely disabled in the settings panel.

---

## Endpoint Details

### POST /ask

Sends a prompt to the current browser session in the background, preserving message history and registering the conversation in the database.

#### Headers
```http
Content-Type: application/json
```

#### Request Parameters (JSON body)

| Parameter | Type | Required | Default | Description |
|:---|:---|:---|:---|:---|
| prompt | string | Yes | - | The query text. Can include local file paths or online media URLs. |
| model | string | No | 3.5 Flash | Swaps the model for the current session. Options: 3.5 Flash, 3.1 Pro, 3.1 Flash-Lite. |
| thinking | string/boolean | No | Standard | Enables deep reasoning mode. Pass Extended, yes, or true to activate. |
| formatting | string | No | CLI | Configures the output format. Options: CLI (ansi terminal markdown), Telegram (HTML-safe Markdown/HTML), HTML (clean raw HTML). |

---

## Response Format

The server returns a structured JSON object containing the result, active model, and conversation ID.

### Success Response (200 OK)

```json
{
  "success": true,
  "response": "Model response text goes here...",
  "conversationId": "42a8408bdb71ff0b",
  "model": "3.5 Flash",
  "thinking": "Standard",
  "formatting": "CLI"
}
```

### Error Response (400 Bad Request or 500 Internal Server Error)

```json
{
  "success": false,
  "error": "Error description details..."
}
```

---

## Usage Examples

### 1. Windows PowerShell
Script to send a POST request from the PowerShell console:

```powershell
$Body = @{
    prompt     = "Summarize this sentence in three words: code is written for people"
    model      = "3.1 Pro"
    thinking   = "Standard"
    formatting = "CLI"
} | ConvertTo-Json -Compress

$Response = Invoke-RestMethod -Uri "http://localhost:8000/ask" -Method Post -ContentType "application/json" -Body $Body
$Response.response
```

### 2. cURL (Unix Shell / Cmd)
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt": "Hello", "model": "3.5 Flash", "formatting": "CLI"}' \
  http://localhost:8000/ask
```

### 3. Node.js (Axios)
```javascript
import axios from 'axios';

async function askGemini() {
  try {
    const res = await axios.post('http://localhost:8000/ask', {
      prompt: "Explain closures in JS in simple terms",
      model: "3.5 Flash",
      thinking: "Standard",
      formatting: "CLI"
    });
    console.log(res.data.response);
  } catch (err) {
    console.error("API Error:", err.response?.data || err.message);
  }
}

askGemini();
```

### 4. Python (Requests)
```python
import requests

url = "http://localhost:8000/ask"
payload = {
    "prompt": "Write a merge sort algorithm in python",
    "model": "3.1 Pro",
    "thinking": "Standard",
    "formatting": "CLI"
}

response = requests.post(url, json=payload)
data = response.json()

if data.get("success"):
    print(data["response"])
else:
    print("Error:", data.get("error"))
```
