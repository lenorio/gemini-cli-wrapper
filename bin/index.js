#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import ora from 'ora';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { ensureLogin, sendPrompt, setDebugMode } from '../src/browser.js';
import { startTUI } from '../src/tui.js';
import { getSessionDir, parsePromptResources } from '../src/utils.js';
import { scrapeWebpage } from '../src/scraper.js';
import { startApiServer } from '../src/api.js';
import { formatResponse } from '../src/formatter.js';
import { saveSettings } from '../src/db.js';

// Setup Markdown Renderer
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

const program = new Command();

program
  .name('gemini-cli')
  .description('Immersive Local Gemini CLI with Playwright automation (No API Key required)')
  .version('2.0.0');

// Default action (if no command is specified, start interactive TUI)
program
  .action(async () => {
    // If running in terminal, start TUI
    if (process.argv.length <= 2) {
      try {
        await startTUI();
      } catch (err) {
        console.error(chalk.red(`TUI Error: ${err.message}`));
        if (err.message.includes('ERR_') || err.message.includes('tunnel') || err.message.includes('proxy')) {
          console.error(chalk.yellow('\n💡 Hint: Connection failed. If your proxy settings are incorrect, reset them by running: gemini-cli logout\n'));
        }
        process.exit(1);
      }
    }
  });

// explicit login command
program
  .command('login')
  .description('Explicitly launch the headful browser to log in to your Google Account')
  .action(async () => {
    try {
      await ensureLogin(true); // force login
    } catch (err) {
      console.error(chalk.red(`Login Error: ${err.message}`));
      process.exit(1);
    }
  });

// explicit logout command
program
  .command('logout')
  .description('Clear saved browser session profiles (logs you out)')
  .action(() => {
    // Reset proxy configuration in DB to prevent lockout on broken proxies
    saveSettings({ proxy: null });
    console.log(chalk.yellow('Proxy configuration cleared. Direct connection restored.'));

    const sessionDir = getSessionDir();
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(chalk.green('Successfully logged out! Saved browser session cleared.'));
      } catch (err) {
        console.error(chalk.red(`Failed to clear session directory: ${err.message}`));
      }
    } else {
      console.log(chalk.yellow('Saved browser session already cleared.'));
    }
  });

// explicit debug command to launch TUI in headful mode
program
  .command('debug')
  .description('Launch the interactive TUI shell in headful debug mode (shows the browser)')
  .action(async () => {
    setDebugMode(true);
    try {
      await startTUI();
    } catch (err) {
      console.error(chalk.red(`TUI Debug Error: ${err.message}`));
      if (err.message.includes('ERR_') || err.message.includes('tunnel') || err.message.includes('proxy')) {
        console.error(chalk.yellow('\n💡 Hint: Connection failed. If your proxy settings are incorrect, reset them by running: gemini-cli logout\n'));
      }
      process.exit(1);
    }
  });

// explicit api command to launch local Express server in foreground
program
  .command('api')
  .description('Launch the local Express API Server on port 8000')
  .action(() => {
    try {
      startApiServer();
    } catch (err) {
      console.error(chalk.red(`API Server Error: ${err.message}`));
      process.exit(1);
    }
  });

// one-off prompt command
program
  .command('prompt')
  .description('Send a single one-off prompt to Gemini')
  .argument('<prompt_text>', 'The question or prompt to send to Gemini')
  .option('-m, --model <model>', 'Model to use (e.g., "3.5 Flash", "3.1 Pro")', '3.5 Flash')
  .option('-t, --thinking <level>', 'Thinking level ("Standard" or "Extended")', 'Standard')
  .option('-f, --formatting <style>', 'Output format style ("CLI", "Telegram", "HTML")', 'CLI')
  .option('-d, --debug', 'Show the browser in headful debug mode')
  .action(async (promptText, options) => {
    try {
      if (options.debug) {
        setDebugMode(true);
      }
      
      // Ensure authenticated first
      await ensureLogin();

      const spinner = ora({
        text: chalk.gray('Sending query to Gemini...'),
        color: 'cyan'
      }).start();

      // Resolve resources
      const { uploads, webUrlsToScrape } = await parsePromptResources(promptText);
      let finalPrompt = promptText;

      // Scrape context if URLs are present
      if (webUrlsToScrape.length > 0) {
        spinner.text = chalk.gray('Scraping webpage contents for context...');
        for (const url of webUrlsToScrape) {
          const scraped = await scrapeWebpage(url);
          if (scraped.success) {
            finalPrompt += `\n\n[Webpage Context: Title: "${scraped.title}" (URL: ${scraped.url})]\n${scraped.content}\n[End Webpage Context]`;
          }
        }
      }

      spinner.text = chalk.gray('Generating response in browser...');

      const response = await sendPrompt({
        prompt: finalPrompt,
        model: options.model,
        thinkingLevel: options.thinking,
        uploads,
        keepAlive: false // Do not keep alive for one-off prompts
      });

      spinner.stop();

      const formatted = formatResponse(response, options.formatting);
      console.log(chalk.dim('\n───────────────────────────────────────────────────────────'));
      if (options.formatting.toUpperCase() === 'CLI') {
        console.log(formatted);
      } else {
        console.log(chalk.green(formatted));
      }
      console.log(chalk.dim('───────────────────────────────────────────────────────────\n'));

    } catch (err) {
      console.error(chalk.red(`Prompt Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
