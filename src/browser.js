import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getSessionDir, extractConversationId, isConversationUrl } from './utils.js';
import { getProxy } from './db.js';
import { startLocalProxyTunnel } from './tunnel.js';

let activeContext = null;
let activePage = null;
let activeTunnel = null;
let debugMode = false;

function debugLog(...args) {
  if (debugMode) {
    console.log(...args);
  }
}

// Set headful debug mode
export function setDebugMode(value) {
  debugMode = value;
  console.log(`[Debug] Headful debug mode set to: ${value}`);
}

// Chrome/Edge launch options
function getLaunchOptions() {
  const sessionDir = getSessionDir();
  
  const options = {
    userDataDir: sessionDir,
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled' // bot check evasion
    ]
  };

  return options;
}

// Helper to launch browser with fallback channels if one fails
async function launchBrowserContext(headless = true) {
  const options = getLaunchOptions();
  options.headless = debugMode ? false : headless;

  const proxyConfig = getProxy();
  if (proxyConfig && proxyConfig.server) {
    if (proxyConfig.server.startsWith('socks5://')) {
      // SOCKS5: spin up local HTTP-to-SOCKS5 bridge tunnel
      debugLog(`[Proxy] SOCKS5 proxy detected. Spanning local HTTP-to-SOCKS5 bridge...`);
      try {
        const tunnel = await startLocalProxyTunnel(proxyConfig);
        activeTunnel = tunnel;
        options.proxy = {
          server: `http://127.0.0.1:${tunnel.port}`
        };
        debugLog(`[Proxy] Local SOCKS5 tunnel is active on port ${tunnel.port}. Routing Chromium traffic through it.`);
      } catch (tunnelErr) {
        console.error(`[Proxy] Failed to initialize local SOCKS5 tunnel: ${tunnelErr.message}`);
      }
    } else {
      // Standard HTTP proxy
      debugLog(`[Proxy] Launching browser context through HTTP proxy: ${proxyConfig.server}`);
      options.proxy = {
        server: proxyConfig.server
      };
      if (proxyConfig.username) {
        options.proxy.username = proxyConfig.username;
      }
      if (proxyConfig.password) {
        options.proxy.password = proxyConfig.password;
      }
    }
  }

  try {
    // Attempt with system Chrome
    return await chromium.launchPersistentContext(options.userDataDir, options);
  } catch (err) {
    console.log(`Failed to launch with system Chrome: ${err.message}. Trying Edge...`);
    try {
      // Fallback to Edge
      options.channel = 'msedge';
      return await chromium.launchPersistentContext(options.userDataDir, options);
    } catch (edgeErr) {
      // Cleanup tunnel on failure
      if (activeTunnel) {
        await activeTunnel.close().catch(() => {});
        activeTunnel = null;
      }
      throw new Error(`Could not find system Chrome or Edge browser. Please install Chrome/Edge: ${edgeErr.message}`);
    }
  }
}

// Check if active session exists and is authenticated
export async function ensureLogin(force = false) {
  const sessionDir = getSessionDir();
  const sessionExists = fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;

  if (sessionExists && !force) {
    const context = await launchBrowserContext(true); // check headlessly
    const page = await context.newPage();
    try {
      await page.goto('https://gemini.google.com/app', { timeout: 15000, waitUntil: 'domcontentloaded' });
      // Check if ql-editor is visible (logged in)
      const isLoggedIn = await page.locator('div.ql-editor').isVisible({ timeout: 5000 }).catch(() => false);
      await context.close();
      if (isLoggedIn) {
        return true;
      }
    } catch (e) {
      await context.close();
    }
  }

  // Not logged in or force login: Open headful browser for manual user authentication
  console.log("\n========================================================");
  console.log("PLEASE LOG IN TO YOUR GOOGLE ACCOUNT IN THE OPENED BROWSER.");
  console.log("After successful login and reaching the Gemini page,");
  console.log("the CLI will automatically capture the session.");
  console.log("========================================================\n");

  const context = await launchBrowserContext(false); // headful
  const page = await context.newPage();
  await page.goto('https://gemini.google.com/app', { timeout: 60000 });

  // Wait for user to log in and prompt textbox to become visible
  try {
    await page.waitForSelector('div.ql-editor', { timeout: 300000 }); // 5 minutes timeout to log in
    console.log("\nLogin successful! Session has been captured and saved.");
    // Wait an additional 3 seconds to let all localstorage/cookies persist
    await page.waitForTimeout(3000);
  } catch (err) {
    console.error("Login timed out or failed:", err.message);
  } finally {
    await context.close();
  }
}

/**
 * Handles toggling standard vs extended thinking mode inside the model selection popup.
 */
async function selectThinkingLevelInBrowser(page, level) {
  // Wait for the model menu button to be visible
  const menuButton = page.locator('button[data-test-id="bard-mode-menu-button"], button[aria-label*="mode picker"]').first();
  try {
    await menuButton.waitFor({ state: 'visible', timeout: 5000 });
  } catch (err) {
    debugLog(`[Warning] Model selection menu not visible on page. Skipping thinking level selection.`);
    return;
  }

  // Ensure the model menu picker is visible or click it to open
  const isMenuOpen = await page.locator('gem-menu-item').first().isVisible().catch(() => false);
  if (!isMenuOpen) {
    await menuButton.click({ force: true });
    await page.waitForSelector('gem-menu-item', { timeout: 5000 });
  }

  // Find the 'Thinking level' submenu item
  const thinkingSubmenuItem = page.locator('gem-menu-item[value="thinking_level"]');
  if (await thinkingSubmenuItem.isVisible()) {
    // Read the current thinking level from sublabel
    const currentSublabel = await thinkingSubmenuItem.locator('.sublabel').innerText().catch(() => '');
    if (currentSublabel.toLowerCase().includes(level.toLowerCase())) {
      // Already correct, click picker again to close the menu
      await menuButton.click({ force: true }).catch(() => {});
      return;
    }
    
    // Click to open the thinking level nested submenu
    await thinkingSubmenuItem.click({ force: true });
    await page.waitForTimeout(500); // Wait for transition
    
    // Select standard or extended item
    const levelSelector = `gem-menu-item[role="menuitem"] >> text=${level}`;
    const levelItem = page.locator(levelSelector).first();
    if (await levelItem.isVisible()) {
      await levelItem.click({ force: true });
      debugLog(`Switched reasoning level to: ${level}`);
      await page.waitForTimeout(500);
    } else {
      // Fallback selector
      const levelItemFallback = page.locator('gem-menu-item').filter({ hasText: level }).first();
      await levelItemFallback.click({ force: true });
      debugLog(`Switched reasoning level to (fallback): ${level}`);
      await page.waitForTimeout(500);
    }
  } else {
    debugLog(`Thinking level settings not available on this model/account.`);
    // Close menu
    await menuButton.click({ force: true }).catch(() => {});
  }
}

/**
 * Handles switching the active model in the browser UI.
 */
async function selectModelInBrowser(page, modelName) {
  // Wait for the model menu button to be visible
  const menuButton = page.locator('button[data-test-id="bard-mode-menu-button"], button[aria-label*="mode picker"]').first();
  try {
    await menuButton.waitFor({ state: 'visible', timeout: 5000 });
  } catch (err) {
    debugLog(`[Warning] Model selection menu not visible on page. Skipping model selection.`);
    return;
  }

  // Open mode picker
  const isMenuOpen = await page.locator('gem-menu-item').first().isVisible().catch(() => false);
  if (!isMenuOpen) {
    await menuButton.click({ force: true });
    await page.waitForSelector('gem-menu-item', { timeout: 5000 });
  }

  // Find matching model item
  // E.g., text matches '3.5 Flash', '3.1 Pro' or 'Flash-Lite'
  const modelItem = page.locator('gem-menu-item').filter({ hasText: modelName }).first();
  if (await modelItem.isVisible()) {
    const isSelected = await modelItem.evaluate(el => el.classList.contains('selected'));
    if (isSelected) {
      // Already selected, close picker
      await menuButton.click({ force: true }).catch(() => {});
      return;
    }
    await modelItem.click({ force: true });
    debugLog(`Switched Gemini model to: ${modelName}`);
    await page.waitForTimeout(1000); // let UI update
  } else {
    debugLog(`Model "${modelName}" option not found in menu.`);
    // Close picker
    await menuButton.click({ force: true }).catch(() => {});
  }
}

/**
 * Closes the active long-running browser session.
 */
export async function closeActiveSession() {
  if (activeContext) {
    try {
      await activeContext.close();
    } catch (_) {}
    activeContext = null;
    activePage = null;
  }
  if (activeTunnel) {
    try {
      await activeTunnel.close().catch(() => {});
    } catch (_) {}
    activeTunnel = null;
  }
}

/**
 * Gets the current active page URL.
 */
export function getActiveUrl() {
  return activePage ? activePage.url() : 'https://gemini.google.com/app';
}

/**
 * Force navigates the active browser to a specific conversation ID.
 */
export async function navigateToConversation(convoId) {
  if (!activePage) {
    activeContext = await launchBrowserContext(!debugMode);
    activePage = await activeContext.newPage();
  }
  await activePage.goto(`https://gemini.google.com/app/${convoId}`, { timeout: 45000, waitUntil: 'domcontentloaded' });
  await activePage.waitForSelector('div.ql-editor', { timeout: 10000 }).catch(() => {});
}

/**
 * Starts a fresh conversation thread (New chat).
 */
export async function startNewChat() {
  if (!activePage) {
    activeContext = await launchBrowserContext(!debugMode);
    activePage = await activeContext.newPage();
  }
  await activePage.goto('https://gemini.google.com/app', { timeout: 45000, waitUntil: 'domcontentloaded' });
  
  const newChatButton = activePage.locator('a[aria-label="New chat"], button[data-test-id="side-nav-sparkle-button"]').first();
  if (await newChatButton.isVisible()) {
    await newChatButton.click({ force: true });
    await activePage.waitForTimeout(1000); // Wait for transition
  }
}

/**
 * Sends a prompt to Gemini web, uploads attachments, configures models/thinking,
 * and extracts the response content.
 */
export async function sendPrompt({ prompt, model, thinkingLevel, uploads = [], keepAlive = true }) {
  // Initialize dynamic page session if not already running
  if (!activePage) {
    activeContext = await launchBrowserContext(!debugMode); // Headless if NOT debugMode
    activePage = await activeContext.newPage();

    // Block unnecessary requests to boost loading speed
    await activePage.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type) && uploads.length === 0) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await activePage.goto('https://gemini.google.com/app', { timeout: 45000, waitUntil: 'domcontentloaded' });
    
    // Wait for the page to stabilize (either redirect to a conversation or render the model picker button)
    for (let i = 0; i < 20; i++) {
      const currentUrl = activePage.url();
      if (isConversationUrl(currentUrl)) {
        break;
      }
      const isMenuVisible = await activePage.locator('button[data-test-id="bard-mode-menu-button"], button[aria-label*="mode picker"]').first().isVisible().catch(() => false);
      if (isMenuVisible) {
        break;
      }
      await activePage.waitForTimeout(300);
    }

    // Check if Google auto-redirected us to the last active conversation thread
    // If so, force click "New chat" to return to zero state, where configuration options are present.
    const url = activePage.url();
    if (isConversationUrl(url)) {
      const newChatButton = activePage.locator('a[aria-label="New chat"], button[data-test-id="side-nav-sparkle-button"]').first();
      if (await newChatButton.isVisible()) {
        await newChatButton.click({ force: true });
        // Wait for the URL to change back to /app and the model picker button to be visible
        await activePage.waitForURL('**/app', { timeout: 5000 }).catch(() => {});
        await activePage.locator('button[data-test-id="bard-mode-menu-button"], button[aria-label*="mode picker"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      }
    } else {
      // If we are at /app zero state, wait for the model picker button to be visible
      await activePage.locator('button[data-test-id="bard-mode-menu-button"], button[aria-label*="mode picker"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    // Configure model and thinking level on initial startup
    if (model) {
      await selectModelInBrowser(activePage, model);
    }
    if (thinkingLevel) {
      await selectThinkingLevelInBrowser(activePage, thinkingLevel);
    }
  } else {
    // If session is already alive, only try to change model if we are at the zero state (not in a conversation thread)
    const currentUrl = activePage.url();
    if (!isConversationUrl(currentUrl)) {
      // We are at zero-state, so we can wait for the menu to be visible
      const menuButton = activePage.locator('button[data-test-id="bard-mode-menu-button"], button[aria-label*="mode picker"]').first();
      try {
        await menuButton.waitFor({ state: 'visible', timeout: 5000 });
        if (model) await selectModelInBrowser(activePage, model);
        if (thinkingLevel) await selectThinkingLevelInBrowser(activePage, thinkingLevel);
      } catch (e) {
        // If not found, skip silently
      }
    }
  }

  const page = activePage;

  try {
    // 2. Upload media attachments if any
    for (const file of uploads) {
      debugLog(`Uploading file attachment: ${path.basename(file.path)}`);
      
      // Target ONLY the visible upload trigger button inside the active bottom input area
      const uploadTrigger = page.locator('input-area-v2 button[aria-label="Upload & tools"]:visible, input-area-v2 button[aria-label="Upload &amp; tools"]:visible, button[aria-label="Upload & tools"]:visible, button[aria-label="Upload &amp; tools"]:visible').first();
      
      // Get the current 'aria-expanded' status to see if it is already open
      let ariaExpanded = await uploadTrigger.getAttribute('aria-expanded').catch(() => 'false');
      debugLog(`Initial aria-expanded status: ${ariaExpanded}`);
      
      if (ariaExpanded !== 'true') {
        debugLog("Upload panel is closed. Clicking trigger button...");
        await uploadTrigger.click({ force: true }); // Bypasses overlay pointer interception!
        await page.waitForTimeout(500); // Allow options to transition in
        const newAria = await uploadTrigger.getAttribute('aria-expanded').catch(() => 'false');
        debugLog(`Aria-expanded status after trigger click: ${newAria}`);
      } else {
        debugLog("Upload panel is already open. Proceeding to select option.");
      }
      
      // Locate the visible upload file options button
      const uploadButton = page.locator('button[data-test-id="local-images-files-uploader-button"]:visible, button:has-text("Upload files"):visible, button[aria-label*="Upload files"]:visible').first();
      
      try {
        // Wait up to 3 seconds for the button to be attached to the DOM
        await uploadButton.waitFor({ state: 'attached', timeout: 3000 });
      } catch (e) {
        // Self-Healing: If still not attached, click the trigger button again
        debugLog("Upload option still not attached. Retrying trigger click...");
        await uploadTrigger.click({ force: true });
        await uploadButton.waitFor({ state: 'attached', timeout: 4000 });
      }
      
      // Wait for file chooser event and select file
      const fileChooserPromise = page.waitForEvent('filechooser');
      await uploadButton.click({ force: true }); // Bypasses overlay pointer interception!
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(file.path);
      
      // Wait for upload progress indicator to finish
      await page.waitForTimeout(3000); // Buffer for upload processing
    }

    // 3. Enter Prompt Text
    const editor = page.locator('div.ql-editor');
    await editor.focus();
    await editor.fill(prompt);
    
    // 4. Click Send Button
    const sendButton = page.locator('button[aria-label="Send message"], [data-test-id="send-button-container"] button');
    await page.waitForTimeout(500); // Short debounce
    await sendButton.click({ force: true }); // Bypasses overlay pointer interception!

    // 5. Wait for Response Generation
    // Heuristic: When generating, the Stop button is visible or the Send button is replaced/disabled.
    console.log("Waiting for Gemini response...");
    
    const stopButtonSelector = 'button[aria-label="Stop generating"], button.send-button.stop';
    await page.waitForSelector(stopButtonSelector, { timeout: 10000 }).catch(() => {});
    
    // Now wait until the stop button disappears and the regular send button becomes enabled again
    await page.waitForSelector('button[aria-label="Send message"]:not([disabled])', { timeout: 120000 });
    
    await page.waitForTimeout(1000);

    // 6. Extract response text
    // We target:
    // - <message-content> (which is the main Angular element for model responses)
    // - .markdown-main-panel (which contains the parsed markdown paragraphs/lists)
    // - fallback to older assistant-messages-primary or .message-text elements
    const responses = page.locator('message-content, .markdown-main-panel, [id*="model-response-message-content"], assistant-messages-primary .content-container, .message-text');
    const count = await responses.count();
    
    if (count > 0) {
      const lastResponse = responses.nth(count - 1);
      let text = await lastResponse.innerText();
      
      // Clean up UI specific boilerplate text from the scrape if present
      text = text.replace(/Show sources/gi, '')
                 .replace(/Share & export/gi, '')
                 .replace(/Modify response/gi, '')
                 .trim();
                 
      if (!keepAlive) {
        await closeActiveSession();
      }
      return text;
    } else {
      // Fallback selector
      const textFallback = await page.locator('.message-text').last().innerText().catch(() => '');
      if (!keepAlive) {
        await closeActiveSession();
      }
      return textFallback || 'Error: Could not retrieve response from Gemini interface.';
    }
  } catch (err) {
    if (!keepAlive) {
      await closeActiveSession();
    }
    throw err;
  }
}
