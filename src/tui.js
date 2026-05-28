import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

import { 
  sendPrompt, 
  ensureLogin, 
  closeActiveSession, 
  getActiveUrl, 
  navigateToConversation, 
  startNewChat 
} from './browser.js';

import { parsePromptResources, extractConversationId, isConversationUrl } from './utils.js';
import { scrapeWebpage } from './scraper.js';
import { formatResponse } from './formatter.js';
import { 
  getSettings, 
  saveSettings, 
  getConversations, 
  saveConversation, 
  getConversationByIdOrName,
  deleteConversation
} from './db.js';

import { startApiServer } from './api.js';

// Setup beautiful terminal markdown renderer
marked.use(markedTerminal({
  showSectionPrefix: false,
  unescape: true,
  emoji: true,
  firstHeading: chalk.bold.cyan,
  heading: chalk.bold.blue,
  strong: chalk.bold.yellow,
  em: chalk.italic.magenta,
  codespan: chalk.bgGray.white,
  code: chalk.gray,
  link: chalk.blue.underline,
  listitem: chalk.green
}));

// Default state of the interactive shell
const STATE = {
  model: '3.5 Flash',
  thinkingLevel: 'Standard',
  formatting: 'CLI',
  planningMode: false,
  isBusy: false
};

// Help Helper
function displayHelp() {
  console.log(chalk.bold.yellow('\n🤖 Available Commands:'));
  console.log(`  ${chalk.cyan('/model')}              Change active model using ${chalk.bold('arrow keys')} (3.5 Flash, 3.1 Pro, etc.)`);
  console.log(`  ${chalk.cyan('/thinking')}           Select reasoning level using ${chalk.bold('arrow keys')} (Standard / Extended)`);
  console.log(`  ${chalk.cyan('/formatting')}         Select output styling using ${chalk.bold('arrow keys')} (CLI, Telegram, HTML)`);
  console.log(`  ${chalk.cyan('/proxy [uri]')}         Configure authorized SOCKS5/HTTP proxy (e.g. user:pass@host:port)`);
  console.log(`  ${chalk.cyan('/reset')}              Start a fresh conversation thread (New chat)`);
  console.log(`  ${chalk.cyan('/plan')}               Toggle Planning Mode (Gemini creates plans first for approval)`);
  console.log(`  ${chalk.cyan('/link')}               Show clickable link to active conversation in Web UI`);
  console.log(`  ${chalk.cyan('/compact')}            Compact conversation memory to save token window limits`);
  console.log(`  ${chalk.cyan('/conversations')}      Interactive dialogue history registry (arrow keys to open!)`);
  console.log(`  ${chalk.cyan('/goto [id/name]')}     Jump straight to a dialogue thread by name or ID`);
  console.log(`  ${chalk.cyan('/rename [id] [name]')} Rename a conversation in the registry`);
  console.log(`  ${chalk.cyan('/add-agent [path]')}   Inject system guidelines from a local markdown agent file`);
  console.log(`  ${chalk.cyan('/savememory')}         Save the markdown history transcript of this chat locally`);
  console.log(`  ${chalk.cyan('/settings')}           Interactive settings control panel`);
  console.log(`  ${chalk.cyan('/clear')}              Clear the console screen`);
  console.log(`  ${chalk.cyan('/exit')} or ${chalk.cyan('/quit')}      Exit the CLI session\n`);
}

// Print TUI Banner
function displayBanner() {
  console.log('\n' + chalk.bold.cyan(' ♊ Gemini Local CLI ') + chalk.dim(`v2.0.0`));
  console.log(chalk.dim('═══════════════════════════════════════════════════════════'));
  console.log(`  ${chalk.bold('Model')}:    ${chalk.cyan(STATE.model)}`);
  console.log(`  ${chalk.bold('Thinking')}: ${STATE.thinkingLevel === 'Extended' ? chalk.yellow.bold('Extended 🧠') : chalk.dim('Standard ⚡')}`);
  console.log(`  ${chalk.bold('Format')}:   ${chalk.green(STATE.formatting)}`);
  console.log(`  ${chalk.bold('Planning')}: ${STATE.planningMode ? chalk.yellow.bold('ON 📋') : chalk.dim('OFF')}`);
  console.log(`  ${chalk.bold('Session')}:  ${chalk.green('Active')}`);
  console.log(chalk.dim('═══════════════════════════════════════════════════════════\n'));
}

// Single-shot readline prompt getter to prevent stream locking
function getLinePrompt() {
  return new Promise((resolve) => {
    process.stdin.resume();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(chalk.cyan('gemini > '), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function startTUI() {
  // Load defaults from DB
  const dbSettings = getSettings();
  if (dbSettings.defaultModel) STATE.model = dbSettings.defaultModel;
  if (dbSettings.defaultThinking) STATE.thinkingLevel = dbSettings.defaultThinking;
  if (dbSettings.defaultFormatting) STATE.formatting = dbSettings.defaultFormatting;

  // First, verify user authentication
  await ensureLogin();

  // Proactively run the API server in background if enabled in settings
  if (dbSettings.enableApi !== false) {
    startApiServer();
  }

  // Print TUI welcome banner
  displayBanner();

  // Start the clean non-blocking loop
  await interactiveLoop();
}

async function interactiveLoop() {
  while (true) {
    const input = await getLinePrompt();
    if (!input) continue;

    // 1. Check for Slash Commands
    if (input.startsWith('/') || input === '?') {
      const parts = input.split(' ');
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      if (cmd === '/exit' || cmd === '/quit') {
        console.log(chalk.cyan('Goodbye!'));
        await closeActiveSession().catch(() => {});
        process.exit(0);
      }
      
      if (cmd === '/clear') {
        console.clear();
        displayBanner();
        continue;
      }

      if (cmd === '/help' || cmd === '?') {
        displayHelp();
        continue;
      }

      // Dynamic Interactive Arrow Menus using Inquirer.js
      if (cmd === '/model') {
        const ans = await inquirer.prompt([{
          type: 'list',
          name: 'model',
          message: 'Select Active Gemini Model:',
          choices: ['3.5 Flash', '3.1 Pro', '3.1 Flash-Lite'],
          default: STATE.model
        }]);
        STATE.model = ans.model;
        await closeActiveSession(); // Reset context to apply model choice
        console.log(chalk.green(`Model updated to: ${chalk.bold(STATE.model)}`));
        continue;
      }

      if (cmd === '/thinking') {
        const ans = await inquirer.prompt([{
          type: 'list',
          name: 'thinking',
          message: 'Select Reasoning Thinking Level:',
          choices: ['Standard', 'Extended'],
          default: STATE.thinkingLevel
        }]);
        STATE.thinkingLevel = ans.thinking;
        await closeActiveSession();
        console.log(chalk.green(`Thinking level set to: ${chalk.bold(STATE.thinkingLevel)}`));
        continue;
      }

      if (cmd === '/formatting') {
        const ans = await inquirer.prompt([{
          type: 'list',
          name: 'formatting',
          message: 'Select Output Formatting Mode:',
          choices: ['CLI', 'Telegram', 'HTML'],
          default: STATE.formatting
        }]);
        STATE.formatting = ans.formatting;
        console.log(chalk.green(`Formatting mode set to: ${chalk.bold(STATE.formatting)}`));
        continue;
      }

      // Proxy Config Command
      if (cmd === '/proxy') {
        if (!arg) {
          const proxy = getSettings().proxy;
          if (proxy && proxy.server) {
            console.log(chalk.gray(`Active proxy server: ${chalk.cyan(proxy.server)}`));
          } else {
            console.log(chalk.gray('No proxy active. Standard direct connection in use.'));
          }
        } else if (arg.toLowerCase() === 'clear') {
          saveSettings({ proxy: null });
          await closeActiveSession();
          console.log(chalk.green('Proxy configuration cleared. Direct connection restored.'));
        } else {
          let protocol = 'http://'; // Default protocol
          let remaining = arg;

          // 1. Extract protocol prefix if present
          const protoMatch = arg.match(/^(socks5:\/\/|http:\/\/|https:\/\/)/i);
          if (protoMatch) {
            protocol = protoMatch[1].toLowerCase();
            remaining = arg.substring(protocol.length);
          }

          // 2. Parse credentials and host/port from the remaining string
          let username = '';
          let password = '';
          let hostPort = remaining;

          if (remaining.includes('@')) {
            const parts = remaining.split('@');
            const creds = parts[0].split(':');
            username = creds[0];
            password = creds[1] || '';
            hostPort = parts[1];
          }

          const server = protocol + hostPort;

          saveSettings({ proxy: { server, username, password } });
          await closeActiveSession();
          console.log(chalk.green(`Proxy server saved and applied: ${chalk.bold(server)}`));
        }
        continue;
      }

      // Start New Chat / Reset Context
      if (cmd === '/reset') {
        const spinner = ora({ text: chalk.gray('Resetting active conversation...'), color: 'cyan' }).start();
        try {
          await startNewChat();
          spinner.stop();
          console.log(chalk.green('Success: Started a fresh conversation context (New Chat).'));
        } catch (e) {
          spinner.stop();
          console.error(chalk.red(`Failed to reset chat: ${e.message}`));
        }
        continue;
      }

      // Toggle Planning Mode
      if (cmd === '/plan') {
        STATE.planningMode = !STATE.planningMode;
        console.log(chalk.green(`Planning mode is now: ${STATE.planningMode ? chalk.bold('ENABLED 📋') : chalk.bold('DISABLED')}`));
        continue;
      }

      // Show clickable Web UI link
      if (cmd === '/link') {
        const url = getActiveUrl();
        console.log(chalk.green(`Clickable Web UI Dialogue Link: `) + chalk.cyan.underline(url));
        continue;
      }

      // Compact Memory Compression Command
      if (cmd === '/compact') {
        STATE.isBusy = true;
        const spinner = ora({ text: chalk.gray('Compressing dialogue memory...'), color: 'cyan' }).start();
        try {
          const prompt = "Пожалуйста, проанализируй историю нашей беседы и кратко суммируй ключевые факты, решения и контекст в один компактный блок консервации (memory compression). Это необходимо для экономии лимита токенов.";
          const response = await sendPrompt({
            prompt,
            model: STATE.model,
            thinkingLevel: STATE.thinkingLevel,
            uploads: []
          });
          spinner.stop();
          console.log(chalk.yellow('\n[Dialogue Memory Block Captured]'));
          console.log(marked.parse(response));
        } catch (e) {
          spinner.stop();
          console.error(chalk.red(`Memory compaction failed: ${e.message}`));
        } finally {
          STATE.isBusy = false;
        }
        continue;
      }

      // System Agentmd injection
      if (cmd === '/add-agent') {
        if (!arg) {
          console.log(chalk.red("Error: Missing local Markdown agent file path. Syntax: /add-agent <path>"));
        } else {
          const absolutePath = path.resolve(arg);
          if (!fs.existsSync(absolutePath)) {
            console.log(chalk.red(`Error: Agent file not found at path: ${absolutePath}`));
          } else {
            try {
              const content = fs.readFileSync(absolutePath, 'utf8');
              const filename = path.basename(absolutePath);
              STATE.isBusy = true;
              const spinner = ora({ text: chalk.gray(`Injecting agent guidelines from ${filename}...`), color: 'cyan' }).start();
              const response = await sendPrompt({
                prompt: `Загружены новые правила поведения системного агента из файла ${filename}:\n\n${content}\n\nС этого момента выполняй мои указания в строгом соответствии с этой ролью. Подтверди готовность.`,
                model: STATE.model,
                thinkingLevel: STATE.thinkingLevel
              });
              spinner.stop();
              console.log(chalk.dim('\n───────────────────────────────────────────────────────────'));
              console.log(marked.parse(response));
              console.log(chalk.dim('───────────────────────────────────────────────────────────\n'));
            } catch (e) {
              console.error(chalk.red(`Failed to inject agent: ${e.message}`));
            } finally {
              STATE.isBusy = false;
            }
          }
        }
        continue;
      }

      // Dialog History Registry Menu
      if (cmd === '/conversations') {
        const convos = getConversations();
        if (convos.length === 0) {
          console.log(chalk.yellow('No saved conversations found. Start prompting to save threads!'));
          continue;
        }

        const choices = convos.map(c => ({
          name: `${c.name || 'Untitled'} (${chalk.cyan(c.id)}) - ${c.model}`,
          value: c.id
        }));
        
        choices.push({ name: chalk.red.bold('<- Cancel'), value: 'cancel' });

        const ans = await inquirer.prompt([{
          type: 'list',
          name: 'id',
          message: 'Select Conversation Thread to Resume:',
          choices
        }]);

        if (ans.id !== 'cancel') {
          // Direct programmatic goto
          STATE.isBusy = true;
          const spinner = ora({ text: chalk.gray(`Navigating browser to thread...`), color: 'cyan' }).start();
          try {
            await navigateToConversation(ans.id);
            spinner.stop();
            console.clear();
            const match = convos.find(c => c.id === ans.id);
            if (match) {
              if (match.model) STATE.model = match.model;
              if (match.thinking) STATE.thinkingLevel = match.thinking;
              if (match.formatting) STATE.formatting = match.formatting;
            }
            displayBanner();
            console.log(chalk.green(`Resumed dialogue thread successfully!\n`));
          } catch (e) {
            spinner.stop();
            console.error(chalk.red(`Navigation failed: ${e.message}`));
          } finally {
            STATE.isBusy = false;
          }
        }
        continue;
      }

      // Go directly to conversation ID/Name
      if (cmd === '/goto') {
        if (!arg) {
          console.log(chalk.red("Error: Please provide a dialogue ID or Name. Syntax: /goto <id/name>"));
        } else {
          const match = getConversationByIdOrName(arg);
          if (!match) {
            console.log(chalk.red(`No dialogue matched ID or Name: "${arg}"`));
          } else {
            STATE.isBusy = true;
            const spinner = ora({ text: chalk.gray(`Navigating browser to thread "${match.name}" (${match.id})...`), color: 'cyan' }).start();
            try {
              await navigateToConversation(match.id);
              spinner.stop();
              console.clear();
              if (match.model) STATE.model = match.model;
              if (match.thinking) STATE.thinkingLevel = match.thinking;
              if (match.formatting) STATE.formatting = match.formatting;
              
              displayBanner();
              console.log(chalk.green(`Resumed dialogue thread successfully! Start typing your message.\n`));
            } catch (e) {
              spinner.stop();
              console.error(chalk.red(`Navigation failed: ${e.message}`));
            } finally {
              STATE.isBusy = false;
            }
          }
        }
        continue;
      }

      // Rename saved conversation
      if (cmd === '/rename') {
        const argParts = arg.split(' ');
        const id = argParts[0];
        const newName = argParts.slice(1).join(' ').trim();

        if (!id || !newName) {
          console.log(chalk.red("Error: Please provide ID and new Name. Syntax: /rename <id> <text>"));
        } else {
          const convo = getConversations().find(c => c.id === id);
          if (!convo) {
            console.log(chalk.red(`Dialogue with ID ${id} not found.`));
          } else {
            saveConversation({ id, name: newName });
            console.log(chalk.green(`Dialogue ${id} successfully renamed to "${newName}"`));
          }
        }
        continue;
      }

      // Dialogue Log Dump Save
      if (cmd === '/savememory') {
        STATE.isBusy = true;
        const spinner = ora({ text: chalk.gray('Requesting dialogue log compilation...'), color: 'cyan' }).start();
        try {
          const response = await sendPrompt({
            prompt: "Суммируй всю историю нашей беседы в виде подробного конспекта (Dialogue Log) в формате Markdown.",
            model: STATE.model,
            thinkingLevel: STATE.thinkingLevel
          });
          spinner.stop();
          
          const convoUrl = getActiveUrl();
          const convoId = extractConversationId(convoUrl) || `save_${Date.now()}`;
          
          const filename = `convo_${convoId}.md`;
          fs.writeFileSync(filename, response, 'utf8');
          console.log(chalk.green(`Dialogue memory log saved successfully to: ${chalk.bold(filename)}`));
        } catch (e) {
          spinner.stop();
          console.error(chalk.red(`Dialogue log saving failed: ${e.message}`));
        } finally {
          STATE.isBusy = false;
        }
        continue;
      }

      // Interactive Settings Panel
      if (cmd === '/settings') {
        const settings = getSettings();
        
        const ans = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'TUI Settings Panel:',
            choices: [
              `Toggle Default Model (Currently: ${settings.defaultModel})`,
              `Toggle Default Thinking (Currently: ${settings.defaultThinking})`,
              `Toggle Default Formatting (Currently: ${settings.defaultFormatting})`,
              `Toggle API Server (Currently: ${settings.enableApi !== false ? 'ON' : 'OFF'})`,
              `Configure API Port (Currently: ${settings.apiPort || 8000})`,
              chalk.red.bold('<- Back')
            ]
          }
        ]);

        if (ans.action.includes('Model')) {
          const modelAns = await inquirer.prompt([{
            type: 'list',
            name: 'v',
            message: 'Set Default Model:',
            choices: ['3.5 Flash', '3.1 Pro', '3.1 Flash-Lite']
          }]);
          saveSettings({ defaultModel: modelAns.v });
          console.log(chalk.green('Default model setting updated.'));
        } else if (ans.action.includes('Thinking')) {
          const thinkAns = await inquirer.prompt([{
            type: 'list',
            name: 'v',
            message: 'Set Default Thinking Level:',
            choices: ['Standard', 'Extended']
          }]);
          saveSettings({ defaultThinking: thinkAns.v });
          console.log(chalk.green('Default thinking level setting updated.'));
        } else if (ans.action.includes('Formatting')) {
          const formatAns = await inquirer.prompt([{
            type: 'list',
            name: 'v',
            message: 'Set Default Formatting Style:',
            choices: ['CLI', 'Telegram', 'HTML']
          }]);
          saveSettings({ defaultFormatting: formatAns.v });
          console.log(chalk.green('Default formatting style updated.'));
        } else if (ans.action.includes('API Server')) {
          const apiAns = await inquirer.prompt([{
            type: 'list',
            name: 'v',
            message: 'Enable API Server:',
            choices: ['ON', 'OFF'],
            default: settings.enableApi !== false ? 'ON' : 'OFF'
          }]);
          saveSettings({ enableApi: apiAns.v === 'ON' });
          console.log(chalk.green(`API Server setting updated to ${apiAns.v}. Restart CLI to apply.`));
        } else if (ans.action.includes('Port')) {
          const portAns = await inquirer.prompt([{
            type: 'input',
            name: 'v',
            message: 'Enter API Port Number (8000-65535):',
            default: String(settings.apiPort || 8000),
            validate: val => !isNaN(parseInt(val)) || 'Please enter a valid number'
          }]);
          saveSettings({ apiPort: parseInt(portAns.v) });
          console.log(chalk.green(`Default API port set to ${portAns.v}. Restart CLI to apply.`));
        }
        continue;
      }

      console.log(chalk.red(`Unknown command: ${cmd}. Type /help or ? for shortcuts.`));
      continue;
    }

    // 2. Standard Prompt execution
    STATE.isBusy = true;
    
    // Prep Planning Mode prompt prefix if enabled
    let finalPrompt = input;
    if (STATE.planningMode) {
      finalPrompt = `Я хочу, чтобы ты сначала разработал подробный пошаговый план реализации (Implementation Plan) для моего запроса. Не пиши готовый код прямо сейчас, только план. Мой запрос: ${input}`;
    }

    const spinner = ora({
      text: chalk.gray('Gemini is generating response...'),
      color: 'cyan'
    }).start();

    try {
      // Parse local paths or media URLs to download
      const { uploads, webUrlsToScrape } = await parsePromptResources(finalPrompt);
      
      // Handle web page scraping context
      if (webUrlsToScrape.length > 0) {
        spinner.text = chalk.gray('Scraping webpage contents for context...');
        for (const url of webUrlsToScrape) {
          const scraped = await scrapeWebpage(url);
          if (scraped.success) {
            finalPrompt += `\n\n[Webpage Context: Title: "${scraped.title}" (URL: ${scraped.url})]\n${scraped.content}\n[End Webpage Context]`;
          }
        }
      }

      spinner.text = chalk.gray('Sending query to Gemini browser...');
      
      const response = await sendPrompt({
        prompt: finalPrompt,
        model: STATE.model,
        thinkingLevel: STATE.thinkingLevel,
        uploads,
        keepAlive: true // Keep active session persistent!
      });

      spinner.stop();
      
      // Print response styled with selected formatting
      const formatted = formatResponse(response, STATE.formatting);
      console.log(chalk.dim('\n───────────────────────────────────────────────────────────'));
      if (STATE.formatting === 'CLI') {
        console.log(formatted);
      } else {
        console.log(chalk.green(formatted));
      }
      console.log(chalk.dim('───────────────────────────────────────────────────────────\n'));

      // Save/Register dialogue in JSON DB
      const convoUrl = getActiveUrl();
      const convoId = extractConversationId(convoUrl) || 'unknown';
      
      const title = input.substring(0, 30).replace(/\n/g, ' ') + (input.length > 30 ? '...' : '');
      saveConversation({
        id: convoId,
        name: title,
        model: STATE.model,
        thinking: STATE.thinkingLevel,
        formatting: STATE.formatting
      });

      // 3. Handle Planning Mode interactive confirmation
      if (STATE.planningMode) {
        const planConfirm = await inquirer.prompt([{
          type: 'confirm',
          name: 'approved',
          message: 'Do you approve this implementation plan?',
          default: true
        }]);

        if (planConfirm.approved) {
          console.log(chalk.cyan('\nPlan approved! Proceeding to execute...\n'));
          const followUpSpinner = ora({ text: chalk.gray('Gemini is executing...'), color: 'cyan' }).start();
          const executeResponse = await sendPrompt({
            prompt: 'План утвержден! Пожалуйста, приступай к реализации.',
            model: STATE.model,
            thinkingLevel: STATE.thinkingLevel,
            keepAlive: true
          });
          followUpSpinner.stop();
          console.log(chalk.dim('\n───────────────────────────────────────────────────────────'));
          if (STATE.formatting === 'CLI') {
            console.log(formatResponse(executeResponse, STATE.formatting));
          } else {
            console.log(chalk.green(formatResponse(executeResponse, STATE.formatting)));
          }
          console.log(chalk.dim('───────────────────────────────────────────────────────────\n'));
        } else {
          console.log(chalk.yellow('\nPlan rejected. Please type what you want to change.\n'));
        }
      }

    } catch (err) {
      spinner.stop();
      console.error(chalk.red(`\nError: ${err.message}\n`));
    } finally {
      STATE.isBusy = false;
    }
  }
}
