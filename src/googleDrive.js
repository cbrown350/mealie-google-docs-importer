import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { createLogger } from './utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import PDFParser from 'pdf2json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger();


// Helper function to convert string to boolean safely
const strToBool = (str) => {
  return str?.toLowerCase() === 'true' || str === '1';
};

const includeRootFolder = strToBool(process.env.INCLUDE_ROOT_FOLDER_AS_TAG);

// Helper function to parse PDF buffer
async function parsePDF(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      const text = decodeURIComponent(pdfData.Pages.reduce((acc, page) => {
        return acc + page.Texts.reduce((textAcc, textItem) => {
          return textAcc + textItem.R.reduce((lineAcc, line) => {
            return lineAcc + line.T + ' ';
          }, '');
        }, '') + '\n';
      }, ''));
      resolve(text);
    });
    
    pdfParser.on("pdfParser_dataError", (error) => {
      reject(new Error(error));
    });

    pdfParser.parseBuffer(buffer);
  });
}

// Helper function to handle .doc files by converting to Google Doc
async function handleDocFile(drive, fileId, fileName) {
  try {
    // Copy the file as a Google Doc
    const copyResponse = await drive.files.copy({
      fileId: fileId,
      requestBody: {
        name: `${fileName} (converted)`,
        mimeType: 'application/vnd.google-apps.document'
      }
    });

    const convertedFileId = copyResponse.data.id;

    try {
      // Export the Google Doc as plain text
      const exportResponse = await drive.files.export({
        fileId: convertedFileId,
        mimeType: 'text/plain'
      });

      return exportResponse.data;
    } finally {
      // Make sure to clean up even if export fails
      await drive.files.delete({
        fileId: convertedFileId
      }).catch(deleteError => {
        logger.error(`Error deleting temporary file: ${deleteError.message}`);
      });
    }
  } catch (error) {
    logger.error(`Error converting .doc file: ${error.message}`);
    throw error;
  }
}

// Define supported MIME types and their handlers
const FILE_HANDLERS = {
  // Google Docs
  'application/vnd.google-apps.document': {
    exportMimeType: 'text/plain',
    handler: async (buffer) => buffer.toString('utf-8')
  },
  // Google Sheets
  'application/vnd.google-apps.spreadsheet': {
    exportMimeType: 'text/csv',
    handler: async (buffer) => buffer.toString('utf-8')
  },
  // Regular text files
  'text/plain': {
    exportMimeType: null,
    handler: async (buffer) => buffer.toString('utf-8')
  },
  // Word documents (.docx)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    exportMimeType: null,
    handler: async (buffer) => {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
  },
  // Legacy Word documents (.doc)
  'application/msword': {
    exportMimeType: null,
    useGoogleConversion: true
  },
  // PDF files
  'application/pdf': {
    exportMimeType: null,
    handler: async (buffer) => {
      return await parsePDF(buffer);
    }
  }
};

export async function setupGoogleDrive() {
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, '..', 'googleDriveCredentials.json'),
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ],
  });

  return google.drive({ version: 'v3', auth });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getFileContent(drive, file) {
  try {
    const handler = FILE_HANDLERS[file.mimeType];
    if (!handler) {
      throw new Error(`Unsupported file type: ${file.mimeType}`);
    }

    // Special handling for .doc files using Google's conversion
    if (handler.useGoogleConversion) {
      return await handleDocFile(drive, file.id, file.name);
    }

    let buffer;
    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      // Handle Google Workspace files
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: handler.exportMimeType
      }, {
        responseType: 'arraybuffer'
      });
      buffer = Buffer.from(response.data);
    } else {
      // Handle regular files
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, {
        responseType: 'stream'
      });

      buffer = await streamToBuffer(response.data);
    }

    // Convert the buffer to text using the appropriate handler
    const content = await handler.handler(buffer);

    if (!content) {
      throw new Error('No content extracted from file');
    }

    return content;
  } catch (error) {
    logger.error(`Error getting content for file ${file.name} (${file.mimeType}): ${error.message}`);
    return null;
  }
}

async function getFolderName(drive, folderId) {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'name'
    });
    return response.data.name;
  } catch (error) {
    logger.error(`Error getting folder name for ${folderId}: ${error.message}`);
    return null;
  }
}

async function listFolderContents(drive, folderId) {
  const mimeTypes = Object.keys(FILE_HANDLERS);
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
  
  async function processFolder(folderId, parentTags = [], isRoot = false) {
    // Get the current folder's name
    const folderName = await getFolderName(drive, folderId);
    // Create current tags array including the current folder name
    const currentTags = isRoot && !includeRootFolder ? [] : [...parentTags, folderName];
    
    const files = await listFolderContents(drive, folderId);
    
    for (const file of files) {
      try {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          // Process subfolder with current tags
          await processFolder(file.id, currentTags);
        } else if (FILE_HANDLERS.hasOwnProperty(file.mimeType)) {
          const content = await getFileContent(drive, file);
          if (content) {
            // Log the tags being added
            logger.info(`Adding tags for ${file.name}: ${currentTags.join(', ')}`);
            
            recipes.push({
              name: file.name,
              content,
              mimeType: file.mimeType,
              tags: currentTags,
              folderName
            });
            logger.info(`Successfully processed ${file.name} (${file.mimeType})`);
          }
        }
      } catch (error) {
        logger.error(`Error processing file ${file.name}: ${error.message}`);
      }
    }
  }
  
  await processFolder(rootFolderId, [], true);
  return recipes;
}