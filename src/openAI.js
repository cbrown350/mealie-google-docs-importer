import OpenAI from 'openai';
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function processRecipeText(text, tags, folderName) {
  const prompt = `Convert this recipe text into a JSON format following the schema.org/Recipe standard. 
Include the following tags: ${tags.join(', ')}

Recipe text:
${text}

Return only the JSON with no other text.`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        { "role": "system", "content": "You are a recipe parser that converts recipe text to schema.org/Recipe JSON format. Make sure to adhere to the proper types and format (don't put arrays where text is supposed to be, for example). Add the objects tags as keywords in the appropriate field. Make sure all the information from the text is in the correct field and don't guess." },
        { "role": "user", "content": prompt }
      ],
      // temperature: 0.3,
    });

    logger.debug('OpenAI Usage:', completion.model, completion.usage);
    // Extract JSON from possible markdown code blocks
    const content = completion.choices[0].message.content;
    logger.debug('Returned JSON:', content);

    const jsonContent = extractJsonFromContent(content);
    
    const recipeJson = JSON.parse(jsonContent);
    
    // Save to output directory
    const filename = sanitizeFilename(folderName + "-" + recipeJson.name) + '.json';
    await writeFile(
      path.join(__dirname, '..', 'output', filename),
      JSON.stringify(recipeJson, null, 2)
    );

    return recipeJson;
  } catch (error) {
    logger.error('OpenAI API error:', error);
    throw error;
  }
}

function extractJsonFromContent(content) {
  // Check if the content contains markdown code blocks
  const jsonRegex = /```(?:json)?\s*([\s\S]*?)```/;
  const match = content.match(jsonRegex);
  
  if (match?.[1]) {
    // Return the content inside code blocks
    return match[1].trim();
  }
  
  // If no code blocks found, assume the content is already JSON
  return content.trim();
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