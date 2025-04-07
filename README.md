# Recipe Importer

Imports recipes from Google Drive documents into Mealie. The program processes Google Docs from a specified folder, converts them to recipe JSON format using OpenAI, and uploads them to a Mealie instance.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Google Cloud project and enable the Google Drive API
3. Create a new OAuth credential, download the credentials JSON file and save it as `googleDriveCredentials.json` in the project root
   - Make sure to set the redirect URI to `http://localhost:3000/oauth2callback` before downloading the JSON file
4. Copy `.env.example` to `.env` and fill in your:
   - OpenAI API key
   - Mealie API URL
   - Mealie API key

## Usage

Run the program with a Google Drive folder ID:

```bash
npm start -- --folderId YOUR_FOLDER_ID
```

The folder ID can be found in the Google Drive URL when viewing the folder.

## Output

- Processed recipes are saved as JSON files in the `output` directory
- Logs are written to `error.log` and `combined.log`
- Recipes are uploaded to your Mealie instance

## Error Handling

- Individual recipe processing failures are logged but won't stop the entire process
- API errors are logged with details
- Network issues are handled gracefully with retries where appropriate