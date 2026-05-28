# Gemini Local CLI - Express REST API Documentation (RU)

Этот инструмент автоматически запускает локальный Express API Server на фоне при старте сессии (если эта опция включена в настройках). Сервер предоставляет простой REST API, с помощью которого можно отправлять запросы в активную фоновую вкладку Gemini из внешних скриптов, программ или средств автоматизации.

---

## Настройки и порт

- Порт по умолчанию: 8000 (можно изменить через команду /settings в чате).
- Адрес запроса: POST http://localhost:8000/ask
- Переключатель сервера: API-сервер можно полностью отключить в панели настроек.

---

## Описание эндпоинта

### POST /ask

Отправляет промпт в текущую сессию браузера в фоновом режиме, сохраняя историю сообщений и регистрируя диалог в базе данных.

#### Заголовки
```http
Content-Type: application/json
```

#### Параметры запроса (JSON body)

| Параметр | Тип | Обязательно | По умолчанию | Описание |
|:---|:---|:---|:---|:---|
| prompt | string | Да | - | Текст вашего запроса. Может содержать пути к локальным файлам или ссылки на медиаресурсы. |
| model | string | Нет | 3.5 Flash | Переключает модель для текущей сессии. Варианты: 3.5 Flash, 3.1 Pro, 3.1 Flash-Lite. |
| thinking | string/boolean | Нет | Standard | Включает режим глубоких размышлений. Передайте Extended, yes или true для активации. |
| formatting | string | Нет | CLI | Настраивает формат возвращаемого ответа. Варианты: CLI (разметка терминала), Telegram (безопасный HTML), HTML (чистый HTML). |

---

## Формат ответа

Сервер возвращает структурированный JSON-объект с результатом выполнения, текущей моделью и ID диалога.

### Успешный ответ (200 OK)

```json
{
  "success": true,
  "response": "Тут будет текст ответа модели...",
  "conversationId": "42a8408bdb71ff0b",
  "model": "3.5 Flash",
  "thinking": "Standard",
  "formatting": "CLI"
}
```

### Ответ при ошибке (400 Bad Request или 500 Internal Server Error)

```json
{
  "success": false,
  "error": "Описание возникшей ошибки..."
}
```

---

## Примеры использования

### 1. Windows PowerShell
Скрипт для отправки POST-запроса из консоли PowerShell:

```powershell
$Body = @{
    prompt     = "Сократи это предложение до трех слов: код пишется для людей"
    model      = "3.1 Pro"
    thinking   = "Standard"
    formatting = "CLI"
} | ConvertTo-Json -Compress

$Response = Invoke-RestMethod -Uri "http://localhost:8000/ask" -Method Post -ContentType "application/json" -Body $Body
$Response.response
```

### 2. cURL (Командная строка CMD / Bash)
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"prompt": "Привет", "model": "3.5 Flash", "formatting": "CLI"}' \
  http://localhost:8000/ask
```

### 3. Node.js (Axios)
```javascript
import axios from 'axios';

async function askGemini() {
  try {
    const res = await axios.post('http://localhost:8000/ask', {
      prompt: "Объясни замыкания в JS простыми словами",
      model: "3.5 Flash",
      thinking: "Standard",
      formatting: "CLI"
    });
    console.log(res.data.response);
  } catch (err) {
    console.error("Ошибка API:", err.response?.data || err.message);
  }
}

askGemini();
```

### 4. Python (Requests)
```python
import requests

url = "http://localhost:8000/ask"
payload = {
    "prompt": "Напиши алгоритм сортировки слиянием на python",
    "model": "3.1 Pro",
    "thinking": "Standard",
    "formatting": "CLI"
}

response = requests.post(url, json=payload)
data = response.json()

if data.get("success"):
    print(data["response"])
else:
    print("Ошибка:", data.get("error"))
```
