import express from 'express';
import cors from 'cors';
import { sendPrompt, getActiveUrl } from './browser.js';
import { formatResponse } from './formatter.js';
import { saveConversation, getSettings } from './db.js';
import { parsePromptResources, extractConversationId } from './utils.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dynamic Port setup from database
const settings = getSettings();
const PORT = settings.apiPort || 8000;

app.post('/ask', async (req, res) => {
  // Read params from JSON body, URL queries, or form data
  const prompt = req.body.prompt || req.query.prompt || req.body.text || req.query.text;
  const rawModel = req.body.model || req.query.model;
  const rawThinking = req.body.thinking || req.query.thinking;
  const rawFormatting = req.body.formatting || req.query.formatting;

  if (!prompt) {
    return res.status(400).json({ success: false, error: "Missing 'prompt' parameter." });
  }

  // 1. Normalize Model
  let resolvedModel = '3.5 Flash';
  if (rawModel) {
    const lowerModel = rawModel.toLowerCase();
    if (lowerModel.includes('pro') || lowerModel.includes('3.1-pro') || lowerModel.includes('3.1 pro')) {
      resolvedModel = '3.1 Pro';
    } else if (lowerModel.includes('lite') || lowerModel.includes('flash-lite')) {
      resolvedModel = '3.1 Flash-Lite';
    } else if (lowerModel.includes('flash') || lowerModel.includes('3.5')) {
      resolvedModel = '3.5 Flash';
    } else {
      resolvedModel = rawModel;
    }
  }

  // 2. Normalize Thinking
  let resolvedThinking = 'Standard';
  if (rawThinking) {
    const lowerThinking = String(rawThinking).toLowerCase();
    if (lowerThinking === 'yes' || lowerThinking === 'true' || lowerThinking === 'extended') {
      resolvedThinking = 'Extended';
    }
  }

  // 3. Normalize Formatting
  let resolvedFormatting = 'CLI';
  if (rawFormatting) {
    const lowerFormatting = rawFormatting.toLowerCase();
    if (lowerFormatting === 'telegram') {
      resolvedFormatting = 'Telegram';
    } else if (lowerFormatting === 'html') {
      resolvedFormatting = 'HTML';
    }
  }

  console.log(`[API] Processing prompt with model: ${resolvedModel}, thinking: ${resolvedThinking}, formatting: ${resolvedFormatting}`);

  try {
    // Resolve resource paths if any
    const { uploads } = await parsePromptResources(prompt);

    // Call browser automation
    const response = await sendPrompt({
      prompt,
      model: resolvedModel,
      thinkingLevel: resolvedThinking,
      uploads,
      keepAlive: true // Keep context alive in background
    });

    // Extract active conversation ID
    const url = getActiveUrl();
    const convoId = extractConversationId(url) || 'unknown';

    // Save/Register conversation in JSON database
    const title = prompt.substring(0, 30).replace(/\n/g, ' ') + (prompt.length > 30 ? '...' : '');
    saveConversation({
      id: convoId,
      name: title,
      model: resolvedModel,
      thinking: resolvedThinking,
      formatting: resolvedFormatting
    });

    // Format output
    const formatted = formatResponse(response, resolvedFormatting);

    res.json({
      success: true,
      response: formatted,
      conversationId: convoId,
      model: resolvedModel,
      thinking: resolvedThinking,
      formatting: resolvedFormatting
    });

  } catch (err) {
    console.error("[API] Error processing prompt:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Launch API server
let serverInstance = null;
export function startApiServer() {
  if (serverInstance) return;
  
  serverInstance = app.listen(PORT, () => {
    console.log(`\n[API Server] Local Express API Server is running at http://localhost:${PORT}`);
    console.log(`[API Server] Endpoint: POST http://localhost:${PORT}/ask`);
    console.log(`[API Server] Example: curl -X POST -H "Content-Type: application/json" -d '{"prompt": "Hello"}' http://localhost:${PORT}/ask\n`);
  });
}
