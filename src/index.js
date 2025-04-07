import dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { setupGoogleDrive, getAllRecipeDocs } from './googleDrive.js';
import { processRecipeText } from './openAI.js';
import { uploadToMealie } from './mealie.js';
import { createLogger } from './utils.js';

dotenv.config();
const logger = createLogger();

const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
if (!folderId) {
  logger.error('GOOGLE_DRIVE_FOLDER_ID environment variable must be set');
  process.exit(1);
}

async function main() {
  try {
    logger.info('Starting recipe import process');
    logger.info(`Using folder ID: ${folderId}`);
    
    // Setup Google Drive client
    const driveClient = await setupGoogleDrive();
    
    // Get all recipe docs from the specified folder
    const recipeDocs = await getAllRecipeDocs(driveClient, folderId);
    
    // Process each recipe
    for (const doc of recipeDocs) {
      try {
        // Convert doc to recipe JSON using OpenAI
        const recipeJson = await processRecipeText(doc.content, doc.tags);
        
        // Upload to Mealie
        await uploadToMealie(recipeJson);
        
        logger.info(`Successfully processed recipe: ${doc.name}`);
      } catch (error) {
        logger.error(`Failed to process recipe ${doc.name}: ${error.message}`);
      }
    }
    
    logger.info('Recipe import process completed');
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();