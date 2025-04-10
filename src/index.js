import { setupGoogleDrive, getAllRecipeDocs } from './googleDrive.js';
import { uploadToMealie, addRecipeTags } from './mealie.js';
import { createLogger, withRetry } from './utils.js';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const logger = createLogger();

const args = process.argv.slice(2);
const folderId = args[0] || process.env.GOOGLE_DRIVE_FOLDER_ID;

const importedTag = process.env.IMPORTED_TAG || "imported";

export async function main() {
  try {
    if (!folderId) {
      logger.error('GOOGLE_DRIVE_FOLDER_ID environment variable must be set');
      throw new Error('Missing folder ID');
    }
    logger.info(`Using folder ID: ${folderId}`);
    
    logger.info('Starting recipe import process');
    
    // Setup Google Drive client
    const driveClient = await setupGoogleDrive();
    
    // Get all recipe docs from the specified folder
    const recipeDocs = await getAllRecipeDocs(driveClient, folderId);
    
    // Process each recipe
    for (const doc of recipeDocs) {
      try {
        // add imported tag to the recipe
        if(importedTag && !doc.tags.includes(importedTag))
          doc.tags = [ ...(doc.tags || []), importedTag ];
        const recipeHtml = doc.content
        
        // Upload to Mealie with retry
        const uploadedRecipe = await withRetry(() => 
          uploadToMealie(recipeHtml, doc.name)
        );
        
        // Add tags if present to recipes in Mealie with retry
        if (doc.tags && doc.tags.length > 0) {
          await withRetry(() => 
            addRecipeTags(uploadedRecipe, doc.tags)
          );
        }
        
        logger.info(`Successfully processed recipe: ${doc.name}`);
      } catch (error) {
        logger.error(`Failed to process recipe ${doc.name}: ${error.message}`);
      }
    }
    
    logger.info('Recipe import process completed');
  } catch (error) {
    logger.error('Fatal error');
    logger.debug('Error details: ', error);
    process.exit(1);
  }
}

main();