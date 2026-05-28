import { marked } from 'marked';
import chalk from 'chalk';

/**
 * Strips HTML tags that are NOT supported by the Telegram Bot API.
 * Telegram only allows: <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>, <span>, <a>, <code>, <pre>.
 */
function sanitizeForTelegram(html) {
  // Replace headings with bold text
  let telegramHtml = html
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '<b>$1</b>\n')
    // Replace paragraphs with double newline
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    // Replace lists
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
    // Remove unsupported divs or spans without permitted attributes
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1')
    // Strip all other unsupported tags, keeping only the approved Telegram subset
    .replace(/<(?!(\/?(b|strong|i|em|u|ins|s|strike|del|span|a|code|pre)))\b[^>]*>/gi, '');

  // Escape HTML entities inside <code> and <pre> blocks so Telegram doesn't break
  telegramHtml = telegramHtml.replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;');

  return telegramHtml.trim();
}

/**
 * Format Gemini's raw markdown response based on selected style.
 * Options: 'CLI', 'HTML', 'Telegram'
 */
export function formatResponse(markdownText, formatStyle = 'CLI') {
  const style = formatStyle.toUpperCase();

  switch (style) {
    case 'HTML':
      // Return standard parsed HTML
      return marked.parse(markdownText);

    case 'TELEGRAM':
      // Parse markdown to HTML first, then sanitize for Telegram Bot API compatibility
      const rawHtml = marked.parse(markdownText);
      return sanitizeForTelegram(rawHtml);

    case 'CLI':
    default:
      // Return terminal styled string using marked-terminal extension
      return marked.parse(markdownText);
  }
}
