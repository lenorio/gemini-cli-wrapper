import os from 'os';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

// Resolve persistent session directory in home folder
export function getSessionDir() {
  return path.join(os.homedir(), '.gemini-cli-session');
}

// Ensure temp directory exists
export function getTempDir() {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

// Clean up temp files
export function cleanTempDir() {
  const tempDir = path.join(process.cwd(), 'temp');
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(path.join(tempDir, file));
    }
  }
}

// Helper to check if string is a valid URL
export function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Download URL to temp path
export async function downloadFile(url) {
  const tempDir = getTempDir();
  const parsedUrl = new URL(url);
  const ext = path.extname(parsedUrl.pathname) || '.tmp';
  const filename = `upload_${Date.now()}${ext}`;
  const targetPath = path.join(tempDir, filename);

  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(targetPath);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(targetPath));
    writer.on('error', (err) => reject(err));
  });
}

// Parse prompt for local files or URLs
// Returns an array of paths that need to be uploaded
// and a cleaned prompt text
export async function parsePromptResources(prompt) {
  // Regex to match URLs or local Windows/Unix paths
  // E.g. https://example.com/image.png, C:\photo.jpg, ./image.png
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const pathRegex = /(?:[a-zA-Z]:\\|\.\/|\.\.\/|[a-zA-Z0-9_-]+\/)[^\s]+(?:\.png|\.jpg|\.jpeg|\.webp|\.gif|\.mp4|\.webm|\.mov)/gi;

  const uploads = [];
  const urls = prompt.match(urlRegex) || [];
  const localPaths = prompt.match(pathRegex) || [];

  // Categorize URLs
  const mediaExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov'];
  const webUrlsToScrape = [];

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const ext = path.extname(parsed.pathname).toLowerCase();
      if (mediaExtensions.includes(ext)) {
        console.log(`Downloading media link: ${url}`);
        const localTempPath = await downloadFile(url);
        uploads.push({ path: localTempPath, type: ext.substring(1) });
      } else {
        webUrlsToScrape.push(url);
      }
    } catch (e) {
      // Not a valid URL, ignore
    }
  }

  // Verify local paths
  for (const p of localPaths) {
    const absolutePath = path.resolve(p);
    if (fs.existsSync(absolutePath)) {
      const ext = path.extname(absolutePath).toLowerCase();
      uploads.push({ path: absolutePath, type: ext.substring(1) });
    }
  }

  return {
    uploads,
    webUrlsToScrape
  };
}

/**
 * Extract conversation ID from a Gemini URL
 */
export function extractConversationId(url) {
  if (!url) return null;
  // Match /app/c/ID or /app/ID where ID is a hex/alphanumeric string of at least 8 characters
  const match = url.match(/\/app\/(?:c\/)?([a-z0-9]{8,})/i);
  return match ? match[1] : null;
}

/**
 * Check if a URL represents a conversation thread
 */
export function isConversationUrl(url) {
  if (!url) return false;
  return url.includes('/app/c/') || /\/app\/[a-z0-9]{8,}/i.test(url);
}
