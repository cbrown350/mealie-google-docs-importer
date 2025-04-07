import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { createLogger } from './utils.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger();

// Define supported MIME types and their export formats
const SUPPORTED_MIME_TYPES = {
  // Google Docs
  'application/vnd.google-apps.document': 'text/plain',
  // Google Sheets (could contain recipes in tabular format)
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  // Regular text files
  'text/plain': null,
  // Word documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'text/plain',
  'application/msword': 'text/plain',
  // Rich Text Format
  'application/rtf': 'text/plain',
  // OpenDocument Text
  'application/vnd.oasis.opendocument.text': 'text/plain',
  // PDF (though text extraction might be imperfect)
  'application/pdf': 'text/plain'
};

export async function setupGoogleDrive() {
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, '..', 'googleDriveCredentials.json'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return google.drive({ version: 'v3', auth });
}

async function getFileContent(drive, file) {
  try {
    let content;
    const exportMimeType = SUPPORTED_MIME_TYPES[file.mimeType];

    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      // Handle Google Workspace files
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: exportMimeType
      }, {
        responseType: 'text'
      });
      content = response.data;
    } else {
      // Handle regular files
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, {
        responseType: 'arraybuffer'
      });
      
      // Convert buffer to string
      content = Buffer.from(response.data).toString('utf-8');
    }

    if (!content) {
      throw new Error('No content received from file');
    }

    return content;
  } catch (error) {
    logger.error(`Error getting content for file ${file.name} (${file.mimeType}): ${error.message}`);
    return null;
  }
}

async function listFolderContents(drive, folderId) {
  const mimeTypes = Object.keys(SUPPORTED_MIME_TYPES);
  const mimeTypeQuery = mimeTypes.map(type => `mimeType = '${type}'`).join(' or ');
  
  const response = await drive.files.list({
    q: `'${folderId}' in parents and (${mimeTypeQuery} or mimeType = 'application/vnd.google-apps.folder')`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000
  });
  return response.data.files;
}

export async function getAllRecipeDocs(drive, rootFolderId) {
  const recipes = [];
  
  async function processFolder(folderId, parentTags = []) {
    const files = await listFolderContents(drive, folderId);
    
    for (const file of files) {
      try {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          // Add folder name as a tag and process contents
          await processFolder(file.id, [...parentTags, file.name]);
        } else if (SUPPORTED_MIME_TYPES.hasOwnProperty(file.mimeType)) {
          const content = await getFileContent(drive, file);
          if (content) {
            recipes.push({
              name: file.name,
              content,
              mimeType: file.mimeType,
              tags: parentTags,
            });
            logger.info(`Successfully processed ${file.name} (${file.mimeType})`);
          }
        }
      } catch (error) {
        logger.error(`Error processing file ${file.name}: ${error.message}`);
      }
    }
  }
  
  await processFolder(rootFolderId);
  return recipes;
}