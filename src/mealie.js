import fetch from 'node-fetch';
import { createLogger } from './utils.js';

const logger = createLogger();


export async function uploadToMealie(recipe, recipeName) {
  const mealiePath = '/api/recipes/create/html-or-json';
  const url = `${process.env.MEALIE_API_URL}${mealiePath}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        "includeTags": true,
        "data": recipe
      })
    });

    if (!response.ok) {
      throw new Error(`Mealie API error: ${response.status} ${response.statusText}`);
    }

    logger.info(`Successfully uploaded recipe: ${recipeName}`);
    return await response.json();
  } catch (error) {
    logger.error(`Failed to upload recipe ${recipeName}: ${error.message}`);
    throw error;
  }
}

export async function addRecipeTags(recipeSlug, tags) {
  const mealiePath = `/api/recipes/${recipeSlug}`;
  const url = `${process.env.MEALIE_API_URL}${mealiePath}`;
  
  try {
    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });
    const data = await response.json();
    const groupId = data?.groupId;
    if (!groupId) {
      throw new Error('No group ID found');
    }
    logger.info(`Using group ID: ${groupId}`);
    logger.info(`Adding tags to recipe: ${recipeSlug}`);

    const fullTags = await fetchMatchingTags(tags);

    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // tags: formattedTags
        groupId,
        tags: fullTags
      })
    });

    if (!response.ok) {
      throw new Error(`Mealie API error: ${response.status} ${response.statusText}`);
    }

    logger.info(`Successfully added tags to recipe: ${recipeSlug}`);
    return await response.json();
  } catch (error) {
    logger.error(`Failed to add tags to recipe ${recipeSlug}: ${error.message}`);
    throw error;
  }
}

export async function fetchMatchingTags(tags) {
  const tagsPath = '/api/organizers/tags';
  const url = `${process.env.MEALIE_API_URL}${tagsPath}`;
  const existingTags = new Map();
  
  try {
    // Fetch all existing tags
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tags: ${response.status} ${response.statusText}`);
    }

    const allTags = await fetchExistingTags();
    allTags.forEach(tag => existingTags.set(tag.name.toLowerCase(), tag));

    // Process each tag
    const processedTags = await Promise.all(tags.map(async tagName => {
      const normalizedName = tagName.toLowerCase();
      
      // If tag exists, return it
      if (existingTags.has(normalizedName)) {
        return existingTags.get(normalizedName);
      }

      // Create new tag if it doesn't exist
      const createResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: tagName,
          slug: tagName.toLowerCase().replace(/\s+/g, '-')
        })
      });

      if (!createResponse.ok) {
        throw new Error(`Failed to create tag ${tagName}: ${createResponse.status} ${createResponse.statusText}`);
      }

      const newTag = await createResponse.json();
      logger.info(`Created new tag: ${tagName}`);
      return newTag;
    }));

    logger.info(`Processed ${processedTags.length} tags`);
    return processedTags;

  } catch (error) {
    logger.error(`Error processing tags: ${error.message}`);
    throw error;
  }
}

export async function fetchExistingTags() {
  const tagsPath = '/api/organizers/tags';
  const url = `${process.env.MEALIE_API_URL}${tagsPath}`;
  
  try {
    // Fetch all existing tags
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.MEALIE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tags: ${response.status} ${response.statusText}`);
    }

    const { items: allTags } = await response.json();
    logger.info(`Fetched ${allTags.length} existing tags`);
    return allTags;
  
  } catch (error) {
    logger.error(`Error processing tags: ${error.message}`);
    throw error;
  }
}