import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Scrapes a webpage URL, extracts the primary readable text content,
 * and formats it neatly to be injected into the prompt.
 */
export async function scrapeWebpage(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, head, nav, footer, iframe, noscript, svg, header').remove();

    const title = $('title').text().trim() || 'Untitled Page';
    
    // Extract meaningful text blocks
    const blocks = [];
    $('h1, h2, h3, h4, h5, p, li').each((i, el) => {
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (text.length > 20) {
        const tag = el.tagName.toLowerCase();
        if (tag.startsWith('h')) {
          blocks.push(`\n## ${text}\n`);
        } else if (tag === 'li') {
          blocks.push(`- ${text}`);
        } else {
          blocks.push(text);
        }
      }
    });

    const pageText = blocks.join('\n').substring(0, 10000); // Limit to 10k chars to avoid blowing token limit

    return {
      success: true,
      url,
      title,
      content: pageText
    };
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
    return {
      success: false,
      url,
      error: err.message
    };
  }
}
