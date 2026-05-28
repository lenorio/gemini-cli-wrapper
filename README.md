# Gemini Local CLI & API Wrapper v2.0.0

[Read in English](README.md) | [Читать на русском](README_RU.md) | [API Documentation](API_DOCS.md)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=Playwright&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)

This tool runs the official Google Gemini interface directly in your terminal and spins up a local API server in the background. It uses Playwright browser automation on top of gemini.google.com. No official API keys, paid subscriptions, or rate limits required.

---

## Features

What the project can do:

- Interactive TUI: A terminal-based chat interface inspired by Claude Code. Just run `gemini-cli` and start prompting.
- Tokenless Login: Sign in once through a headful browser window, and your session persists locally. All future runs execute headlessly in the background.
- Model Swaps: Swap models (3.5 Flash, 3.1 Pro, 3.1 Flash-Lite) on the fly during a chat.
- Reasoning Controls: Toggle deep thinking (Extended reasoning) instantly through the interactive menu.
- Authenticated SOCKS5 Proxy Tunneling: Chromium doesn't support SOCKS5 proxies that require a username and password out of the box. We bypassed this by building a custom, pure Node.js HTTP-to-SOCKS5 bridge tunnel. Your traffic routes safely through a local mediator.
- Web Ingestion: Drop any link in your prompt, and the script automatically downloads the webpage, strips away markup/ads, and feeds it to Gemini as raw context.
- File Uploads: Attach local files or images by referencing their paths directly inside your prompt text.
- Planning Mode: Forces Gemini to generate step-by-step plans first and wait for your explicit Yes/No confirmation before executing tasks.
- Thread Registry & Registry Jumps: Open historical dialogs using arrow keys, jump directly to threads by ID, rename chats, or export history to Markdown.

---

## One-Step Installation

Select the command suited for your operating system to automatically install Node packages, download Chromium for Playwright, and link the CLI globally on your system.

### Windows (CMD)
Run the install.bat file or execute:
```cmd
install.bat
```

### Windows (PowerShell)
```powershell
.\install.ps1
```

### macOS / Linux
```bash
chmod +x install.sh && ./install.sh
```

---

## First Run & Authentication

Before your first prompt, initiate the Google login flow so the CLI can capture your session securely:
```bash
gemini-cli login
```
1. A real Chrome or Edge browser window will open.
2. Sign in to your Google Account as you normally would (supports 2FA and hardware keys).
3. Once the Gemini main chat window loads successfully, the console stores the session and closes the browser window automatically. All data is saved locally at ~/.gemini-cli-session.
4. You won't need to log in again. All future queries will run silently in the background.

---

## Interactive Chat Usage

To launch the interactive terminal, simply execute:
```bash
gemini-cli
```

### Available Slash Commands

| Command | Action |
|:---|:---|
| /help or ? | Show available commands |
| /model | Select active model using arrow keys (Flash, Pro, Flash-Lite) |
| /thinking | Toggle reasoning level using arrow keys (Standard / Extended) |
| /formatting | Select output format using arrow keys (CLI, Telegram, HTML) |
| /proxy | Configure proxy settings or clear them (/proxy clear) |
| /reset | Start a fresh conversation context (New chat) |
| /plan | Toggle planning mode (review plans before code execution) |
| /link | Return a clickable link to the active conversation in the web interface |
| /conversations | Interactive dialogue history list (use arrow keys to swap!) |
| /goto [id/name] | Jump straight to a dialogue thread by name or ID |
| /rename [id] [name] | Rename a conversation in the registry |
| /add-agent [path] | Load custom agent behavioral rules from a markdown file |
| /compact | Compact conversation history to save token window limits |
| /savememory | Compile and save active conversation transcript as a markdown file |
| /settings | Interactive settings panel (API port, default model, API server status) |
| /clear | Clear terminal screen |
| /exit or /quit | Safely close the browser session and exit |

---

## Local REST API

The project automatically launches an Express server on port 8000 (if enabled in settings). This allows external scripts to interact with your active Gemini session.

- **Address**: POST http://localhost:8000/ask
- **Method**: POST
- **Request Parameters (JSON)**:
  - prompt (string, required): The prompt text.
  - model (string, optional): Swap model.
  - thinking (string, optional): Reasoning level.
  - formatting (string, optional): Output style format.

For a detailed description of the API structure, response formats, and complete scripts for cURL, PowerShell, Python, and Node.js, see [API_DOCS.md](API_DOCS.md).

---

## Security

Your browser session profile is stored locally on your machine:
- Windows: C:\Users\<Username>\.gemini-cli-session
- Mac/Linux: ~/.gemini-cli-session

Session data is never sent to any third-party server and is used exclusively to interact with the official gemini.google.com interface.
