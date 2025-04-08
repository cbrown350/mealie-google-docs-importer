import OpenAI from 'openai';
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils.js';
import { fetchExistingTags } from './mealie.js';
import { JSDOM } from 'jsdom';

const logger = createLogger();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  logger.error('OPENAI_API_KEY environment variable must be set');
  process.exit(1);
}

const model = process.env.OPENAI_MODEL || 'gpt-4o-mini-search-preview';
if (!model) {
  logger.error('OPENAI_MODEL environment variable must be set');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openai = new OpenAI({
  apiKey,
});

export async function processRecipeText(text, tags, fileName, folderName) {
  const prompt = `Convert this recipe text to a nice, readable, simple web page. Do not create garbage at the end of the response or in the url (make sure it's valid) or hallucinate. Include a few keywords in the html header that match the recipe content and listed tags. Also include the calculated nutrion values per serving and total at the bottom based on the food quantities. Return the html document text you created only with no other information.
Include the following tags: ${tags.join(', ')}

Recipe text:
${text}

Return only the JSON with no other text.`;

  let content;
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [ // Optionally, add a picture as a url href that you will search and find that best matches the recipe to the webpage that has a working url. Do not try to create a url that doesn't exist or doesn't work.
        { "role": "system", "content": "You are a recipe parser that converts recipe text to a nice, readable, simple html web page." },
        { "role": "user", "content": prompt }
      ],
      // temperature: 0.3,
    });

    logger.debug('OpenAI Usage:', completion.model, completion.usage);
    // Extract JSON from possible markdown code blocks
    content = completion.choices[0].message.content;
    logger.debug('Returned content:', content);
  } catch (error) {
    logger.error('OpenAI API error:', error);
    throw error;
  }

  const htmlContent = extractHtmlFromContent(content);

  try {    
    // Save to output directory
    const filename = sanitizeFilename(folderName + "-" + fileName) + '.html';
    await writeFile(
      path.join(__dirname, '..', 'output', filename),
      htmlContent
    );
  } catch (error) {
    logger.error('File save error:', error);
  }

  return htmlContent;
}

function extractHtmlFromContent(content) {
  
  const htmlRegex = /```html\s*\n([\s\S]*?)\n\s*```/;
  let match = content.match(htmlRegex);

  if (match?.[1]) {
  // Extract the HTML content
    const html =  match[1]
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
        .replace(/\\n/g, '\n')                 // Convert escaped newlines to actual newlines
        .replace(/\\"/g, '"')                  // Convert escaped quotes to quotes
        .replace(/\\\\/g, '\\')                // Convert double backslashes to single
        .replace(/\r\n/g, '\n')               // Normalize line endings
        .trim();

    // Validate the extracted HTML
    if (isValidHtml(html)) {
      return html;
    }
    logger.debug('Invalid HTML structure in extracted content');
  } else {
    logger.debug('No valid HTML code block found');
  }

  const jsonRegex = /```json\s*\n\s*({[\s\S]*?})\s*\n\s*```/;
  match = content.match(jsonRegex);
  
  if (match?.[1]) {
    try {
      const jsonContent = JSON.parse(match[1]);
      // Unescape any escaped newlines and quotes
      const html = jsonContent.html
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
  
        if (!isValidHtml(html)) {
          logger.debug('Invalid HTML structure detected');
          throw new Error('Invalid HTML structure');
        }

        return html;
    } catch (error) {
      logger.debug('Failed to match JSON or Html content:', error);
    }
  }

  try {
    return JSON.parse(content).html;
  } catch (error) { 
    logger.debug('Failed to parse JSON content:', error);
  }

  if(isValidHtml(content)) {
    return content;
  }
  const errMsg = 'Failed all attempts to extract HTML content.';
  logger.error(errMsg);
  throw new Error(errMsg);
}

function isValidHtml(html) {
  if (typeof html !== 'string') return false;
  if (html.trim().length === 0) return false;

  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Check if parsing produced any parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) return false;
    
    // Verify basic HTML structure
    const hasHtmlTag = doc.querySelector('html') !== null;
    const hasBodyTag = doc.querySelector('body') !== null;
    
    return hasHtmlTag && hasBodyTag;
  } catch (error) {
    logger.debug("Error during HTML validation:", error);
    return false;
  }
}

function sanitizeFilename(name) {
  if (!name) return 'recipe';
  
  // Convert to lowercase
  let filename = name.toLowerCase();
  
  // Replace spaces and invalid characters with hyphens
  filename = filename.replace(/[/\\?%*:|"<>]/g, '-');
  
  // Replace multiple hyphens with a single one
  filename = filename.replace(/-+/g, '-');
  
  // Remove leading and trailing hyphens
  filename = filename.replace(/^-+|-+$/g, '');
  
  // Ensure filename isn't too long (max 100 chars)
  filename = filename.substring(0, 100);
  
  return filename || 'recipe';
}