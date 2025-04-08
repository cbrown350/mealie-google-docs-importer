import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { createLogger } from './utils.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath, URLSearchParams } from 'url';
import mammoth from 'mammoth';
import PDFParser from 'pdf2json';
import http from 'http';
import open from 'open';  

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger();

const credentialsPath = path.join(__dirname, '..', 'googleDriveCredentials.json');
const tokenPath = path.join(__dirname, '..', 'googleDriveToken.json');

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

// async function loadSavedToken() {
//   try {
//     const tokenContent = await fs.readFile(tokenPath);
//     const token = JSON.parse(tokenContent);
//     return {
//       client_id: token.client_id,
//       client_secret: token.client_secret,
//       refresh_token: token.refresh_token,
//       type: token.token_type,
//       scope: token.scope
//     };
//   } catch (error) {
//     logger.info('No saved Google token found or token invalid');
//     return null;
//   }
// }

// Modify the setupGoogleDrive function
export async function setupGoogleDrive() {
  // let auth;
  // const savedToken = await loadSavedToken();

  // if (savedToken) {
  //   try {
  //     // Create OAuth2 client with saved credentials
  //     const oauth2Client = new google.auth.OAuth2(
  //       savedToken.client_id,
  //       savedToken.client_secret,
  //       'urn:ietf:wg:oauth:2.0:oob'
  //     );

  //     // Set credentials
  //     oauth2Client.setCredentials({
  //       refresh_token: savedToken.refresh_token,
  //       scope: savedToken.scope,
  //       token_type: savedToken.type
  //     });

  //     // Test the token by making a simple API call
  //     const testDrive = google.drive({ version: 'v3', auth: oauth2Client });
  //     await testDrive.files.list({ pageSize: 1 });

  //     auth = oauth2Client;
  //     logger.info('Successfully authenticated using saved Google token');
  //   } catch (error) {
  //     logger.debug(error.message);
  //     logger.warn('Saved Google token is invalid, proceeding with new authentication');
  //     auth = null;
  //   }
  // }

  // if (!auth) {
  //   // If no valid saved token, authenticate normally
  //   auth = await authenticate({
  //     keyfilePath: credentialsPath,
  //     scopes: [
  //       'https://www.googleapis.com/auth/drive.readonly',
  //       'https://www.googleapis.com/auth/drive.file'
  //     ],
  //   });

  //   // Save the new token
  //   await fs.writeFile(
  //     tokenPath,
  //     JSON.stringify({
  //       access_token: auth.credentials.access_token,
  //       refresh_token: auth.credentials.refresh_token,
  //       scope: auth.credentials.scope,
  //       token_type: auth.credentials.token_type,
  //       expiry_date: auth.credentials.expiry_date,
  //       client_id: auth._clientId,
  //       client_secret: auth._clientSecret
  //     }, null, 2)
  //   );
  // }

  // return google.drive({ version: 'v3', auth });

  
  return google.drive({ version: 'v3', auth: await authorize() });
}


/**
 * Load previously authorized credentials from the save file.
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
 * Save token credentials to a file.
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
 * Authorize the client and obtain refresh tokens.
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if(client) {
    return client;
  }
  logger.warn('Saved credentials invalid or not found, proceeding with new authentication');

  // client = await authenticate({
  //   scopes: [
  //     'https://www.googleapis.com/auth/drive.readonly',
  //     'https://www.googleapis.com/auth/drive.file'
  //   ],
  //   redirectUri: 'http://localhost:3000/oauth2callback',
  //   keyfilePath: credentialsPath,
  //   forceNewAuth: true,
  //   accessType: 'offline',
  //   prompt: 'consent'
  // });

  // if(client.credentials?.refresh_token) {
  //   await saveCredentials(client);
  //   logger.info('Google credentials saved successfully');
  // } else {
  //   logger.warn('No refresh token obtained. Please check your Google API settings.');
  // }

  // return client;
  

  // Read credentials file
  const content = await fs.readFile(credentialsPath);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    'http://localhost:3000/oauth2callback'
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
        reject(err);
      }
    }).listen(3000);

    // Generate authentication URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file'
      ],
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