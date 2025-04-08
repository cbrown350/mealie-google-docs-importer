import dotenv from 'dotenv';
import { setupGoogleDrive, getAllRecipeDocs } from './googleDrive.js';
import { processRecipeText } from './openAI.js';
import { uploadToMealie, addRecipeTags } from './mealie.js';
import { createLogger, withRetry } from './utils.js';

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
        doc.tags = [ ...(doc.tags || []), "imported" ];
       
        // Convert doc to recipe Html using OpenAI with retry
        const recipeHtml = await withRetry(() => 
          processRecipeText(doc.content, doc.tags, doc.name, doc.folderName)
        );
        
        // Upload to Mealie with retry
        const uploadedRecipe = await withRetry(() => 
          uploadToMealie(recipeHtml, doc.name)
        );
        
        // Add tags if present with retry
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
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();