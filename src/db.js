import fs from 'fs';
import path from 'path';
import { getSessionDir } from './utils.js';

const DB_PATH = path.join(getSessionDir(), 'db.json');

const DEFAULT_DB = {
  settings: {
    defaultModel: '3.5 Flash',
    defaultThinking: 'Standard',
    defaultFormatting: 'CLI',
    apiPort: 8000,
    enableApi: true,
    proxy: null // { server: 'socks5://...', username: '', password: '' }
  },
  conversations: [] // Array of { id, name, model, thinking, formatting, createdAt }
};

// Ensure database file exists and is populated
function ensureDb() {
  const sessionDir = getSessionDir();
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

// Load full database
export function loadDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read database. Resetting to default:", err.message);
    return DEFAULT_DB;
  }
}

// Save full database
export function saveDb(data) {
  ensureDb();
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("Failed to save database:", err.message);
  }
}

// Settings getters/setters
export function getSettings() {
  const db = loadDb();
  return { ...DEFAULT_DB.settings, ...db.settings };
}

export function saveSettings(newSettings) {
  const db = loadDb();
  db.settings = { ...db.settings, ...newSettings };
  saveDb(db);
}

// Proxy getter/setter
export function getProxy() {
  return getSettings().proxy;
}

export function saveProxy(proxyConfig) {
  saveSettings({ proxy: proxyConfig });
}

// Conversation getters/setters
export function getConversations() {
  const db = loadDb();
  return db.conversations || [];
}

export function saveConversation(convo) {
  const db = loadDb();
  const index = db.conversations.findIndex(c => c.id === convo.id);
  
  const convoData = {
    ...convo,
    createdAt: convo.createdAt || new Date().toISOString()
  };

  if (index !== -1) {
    db.conversations[index] = { ...db.conversations[index], ...convoData };
  } else {
    db.conversations.push(convoData);
  }
  saveDb(db);
}

export function deleteConversation(id) {
  const db = loadDb();
  db.conversations = db.conversations.filter(c => c.id !== id);
  saveDb(db);
}

export function getConversationByIdOrName(search) {
  const conversations = getConversations();
  const lowerSearch = search.toLowerCase();
  
  // Try exact ID match first
  let match = conversations.find(c => c.id === search);
  if (match) return match;
  
  // Try name match
  match = conversations.find(c => c.name && c.name.toLowerCase() === lowerSearch);
  if (match) return match;
  
  // Try partial name match
  match = conversations.find(c => c.name && c.name.toLowerCase().includes(lowerSearch));
  return match;
}
