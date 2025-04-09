import { google } from 'googleapis';
import { createLogger } from './utils.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath, URLSearchParams } from 'url';
import mammoth from 'mammoth';
import PDFParser from 'pdf2json';
import http from 'http';
import open from 'open';  
import dotenv from 'dotenv';

dotenv.config();

const oauth2RedirectPort = process.env.OAUTH2_REDIRECT_PORT || 3000;
const oauth2RedirectUrl = process.env.OAUTH2_REDIRECT_URL || `http://localhost:${oauth2RedirectPort}/oauth2callback`;
const oauth2Scopes = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file'
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const credentialsPath = path.join(__dirname, '..', 'googleDriveCredentials.json');
const tokenPath = path.join(__dirname, '..', 'googleDriveToken.json');

const logger = createLogger();


// Helper function to convert string to boolean safely
const strToBool = (str) => {
  return str?.toLowerCase() === 'true' || str === '1';
};


/**
 * Parses a PDF buffer to extract text content
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<string>} Extracted text content from the PDF
 */
async function parsePDF(buffer) {
  const pdfParser = new PDFParser();
  return new Promise((resolve, reject) => {
    // Cleanup function to destroy the parser
    const cleanup = () => {
      try {
        pdfParser.destroy();
      } catch (err) {
        logger.warn(`Error cleaning up PDFParser: ${err.message}`);
      }
    };
    
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      const text = decodeURIComponent(pdfData.Pages.reduce((acc, page) => {
        return acc + page.Texts.reduce((textAcc, textItem) => {
          return textAcc + textItem.R.reduce((lineAcc, line) => {
            return lineAcc + line.T + ' ';
          }, '');
        }, '') + '\n';
      }, ''));
      cleanup();
      resolve(text);
    });
    
    pdfParser.on("pdfParser_dataError", (error) => {
      cleanup();
      reject(new Error(`Error parsing PDF data: ${error.parserError}`));
    });


    try {
      pdfParser.parseBuffer(buffer);
    } catch (err) {
      cleanup();
      reject(new Error(`Error parsing PDF buffer: ${err.message}`));
    }
  });
}


/**
 * Converts a Microsoft Word (.doc) file to plain text by:
 * 1. Creating a temporary Google Doc copy
 * 2. Exporting that copy as plain text
 * 3. Deleting the temporary copy
 *
 * @param {drive} drive - The Google Drive client instance
 * @param {string} fileId - The ID of the .doc file to convert
 * @param {string} fileName - The name of the file (used for naming the temporary copy)
 * @returns {Promise<string>} The plain text content of the document
 * @throws {Error} If the conversion process fails
 */
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
}


/**
 * Sets up Google Drive API client
 * @returns {Object} Configured Google Drive API client
 */
export async function setupGoogleDrive() {  
  return google.drive({ version: 'v3', auth: await authorize() });
}


/**
 * Attempts to load saved Google Drive credentials from the local token file.
 * Validates the loaded token by making a test API call.
 *
 * @returns {Promise<OAuth2Client|null>} The authenticated Google client if valid credentials exist,
 *                                      null otherwise
 */
async function loadSavedCredentialsIfExist() {
  try {
    if (!await fs.access(tokenPath).then(() => true).catch(() => false)) {
      logger.debug('Google token file does not exist');
      return null;
    }
    const content = await fs.readFile(tokenPath);
    const credentials = JSON.parse(content);
    const client = google.auth.fromJSON(credentials);

    // Test the token by making a simple API call
    const testDrive = google.drive({ version: 'v3', auth: client });
    await testDrive.files.list({ pageSize: 1 });
    logger.info('Found a valid Google token');

    return client;
  } catch (err) {
    logger.debug(err.message);
    logger.info('Existing Google token invalid');
    await fs.unlink(tokenPath).catch(err => {
      logger.error(`Failed to delete invalid Google token file: ${err.message}`);
    });
    return null;
  }
}


/**
 * Saves OAuth2 credentials to the filesystem
 * @param {Object} client - Google API client with credentials
 */
async function saveCredentials(client) {
  try {
    const content = await fs.readFile(credentialsPath);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(tokenPath, payload);
  } catch (err) {
    logger.error('Error loading/saving Google credentials:', err);
  }
}


/**
 * Authorizes with Google API using OAuth2
 * @returns {Object} Authorized Google API client
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if(client) {
    return client;
  }
  logger.warn('Saved credentials invalid or not found, proceeding with new authentication');
  

  // Read credentials file
  const content = await fs.readFile(credentialsPath);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    oauth2RedirectUrl
  );

  // Get auth code via local server
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/oauth2callback')) {
          const params = new URLSearchParams(req.url.split('?')[1]);
          const code = params.get('code');
          res.end('Authentication successful! You can close this window.');
          server.close();
          resolve(code);
        }
      } catch (err) {
        reject(new Error(err));
      }
    }).listen(oauth2RedirectPort);

    // Generate authentication URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: oauth2Scopes,
      prompt: 'consent'
    });

    // Open the auth URL in browser
    open(authUrl);
  });

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (tokens.refresh_token) {    
    await saveCredentials(oauth2Client);
    logger.info('Google token credentials saved successfully');
  } else{
    logger.warn('No Google refresh token obtained. Please check your Google API settings.');
  }

  return oauth2Client;
}


/**
 * Converts a readable stream to a buffer
 * @param {Stream} stream - Readable stream
 * @returns {Promise<Buffer>} Buffer containing stream data
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}


/**
 * Gets content from a Google Drive file
 * @param {Object} drive - Google Drive API client
 * @param {Object} file - File metadata object
 * @returns {Promise<string|null>} File content as text or null if extraction failed
 */
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


/**
 * Retrieves the name of a Google Drive folder.
 *
 * @param {drive} drive - The Google Drive client instance
 * @param {string} folderId - The ID of the folder to retrieve the name for
 * @returns {Promise<string|null>} The folder name if successful, null if an error occurs
 */
async function getFolderName(drive, folderId) {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'name'
    });
    return response.data.name;
  } catch (error) {
    logger.error(`Error getting folder name for ${folderId}: ${error.message}; the Google Drive folder ID is likely incorrect.`);
    return null;
  }
}


/**
 * Lists all files and folders within a Google Drive folder
 * @param {Object} drive - Google Drive API client
 * @param {string} folderId - ID of the folder to list
 * @returns {Promise<Array>} Array of file and folder metadata objects
 */
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


/**
 * Recursively retrieves all recipe documents from a Google Drive folder and its subfolders
 * @param {Object} drive - Google Drive API client
 * @param {string} rootFolderId - ID of the root folder to search
 * @returns {Promise<Array>} Array of recipe documents with content, metadata and folder-based tags
 */
export async function getAllRecipeDocs(drive, rootFolderId) {
  const recipes = [];
  
  async function processFolder(folderId, parentTags = [], isRoot = false) {
    // Create current tags array including the current folder name if appropriate
    const currentTags = [...parentTags];
    const includeRootFolder = strToBool(process.env.INCLUDE_ROOT_FOLDER_AS_TAG);
    if(includeRootFolder || !isRoot) {
      const folderName = await getFolderName(drive, folderId);
      if (folderName) {
        currentTags.push(folderName);
      }
    }
    
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
              tags: currentTags
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
