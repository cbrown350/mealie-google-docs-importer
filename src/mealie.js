import fetch from 'node-fetch';
import { createLogger } from './utils.js';

const logger = createLogger();

export async function uploadToMealie(recipe) {
  const mealiePath = '/api/recipes';
  const url = `${process.env.MEALIE_API_URL}${mealiePath}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recipe)
    });

    if (!response.ok) {
      throw new Error(`Mealie API error: ${response.status} ${response.statusText}`);
    }

    logger.info(`Successfully uploaded recipe: ${recipe.name}`);
    return await response.json();
  } catch (error) {
    logger.error(`Failed to upload recipe ${recipe.name}: ${error.message}`);
    throw error;
  }
}