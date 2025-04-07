import OpenAI from 'openai';
import { writeFile } from 'fs/promises';
import path from 'path';
import { createLogger } from './utils.js';

const logger = createLogger();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function processRecipeText(text, tags) {
  const prompt = `Convert this recipe text into a JSON format following the schema.org/Recipe standard. 
Include the following tags: ${tags.join(', ')}

Recipe text:
${text}

Return only the JSON with no other text.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { "role": "system", "content": "You are a recipe parser that converts recipe text to schema.org/Recipe JSON format." },
        { "role": "user", "content": prompt }
      ],
      temperature: 0.3,
    });

    const recipeJson = JSON.parse(completion.choices[0].message.content);
    
    // Save to output directory
    const filename = `${recipeJson.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.json`;
    await writeFile(
      path.join('output', filename),
      JSON.stringify(recipeJson, null, 2)
    );

    return recipeJson;
  } catch (error) {
    logger.error('OpenAI API error:', error);
    throw error;
  }
}