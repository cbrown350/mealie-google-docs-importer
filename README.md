# Recipe Importer

Imports recipes from Google Drive documents into Mealie. The program processes Google Docs from a specified folder, converts them to basic HTML using OpenAI, and uploads them to a Mealie instance.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Google Cloud project and enable the Google Drive API
3. Create a new OAuth credential, download the credentials JSON file and save it as `googleDriveCredentials.json` in the project root
   - Make sure to set the redirect URI to `http://localhost:3000/oauth2callback` before downloading the JSON file
4. Copy `.env.example` to `.env` and fill in your:
   - OpenAI API settings
   - Mealie API URL and key
   - Google Drive root folder ID

## Usage

Run the program using the Google Drive folder ID set in the `.env` file:

```bash
npm start
```

The folder ID can be found in the Google Drive URL when viewing the folder.

## Output

- Processed recipes are saved as HTML files in the `output` directory
- Logs are written to `error.log` and `combined.log`
- Recipes are uploaded to your Mealie instance
- Tags are added to the recipes based on the folder structure in Google Drive

## Error Handling

- Individual recipe processing failures are logged but won't stop the entire process
- API errors are logged with details
- Network issues are handled gracefully with retries where appropriate