# Mealie Google Drive Recipe Importer

[![CI](https://github.com/cbrown350/mealie-google-docs-importer/workflows/CI/badge.svg)](https://github.com/cbrown350/mealie-google-docs-importer/actions)
[![Coverage](https://raw.githubusercontent.com/cbrown350/mealie-google-docs-importer/badges/.github/badges/coverage.svg)](https://htmlpreview.github.io/?https://github.com/cbrown350/mealie-google-docs-importer/blob/badges/coverage/lcov-report/index.html)

Imports recipes from Google Drive documents into [Mealie](https://mealie.io), a recipe manager. The app gets the text of Google Docs from the specified root folder and subfolders and uploads them to a Mealie instance where they are parsed using OpenAI if set up properly.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Google Cloud project in the [Google Cloud Console](https://console.cloud.google.com)
3. In the project, enable the Google Drive API, create a new OAuth credential, download the credentials JSON file and save it as `googleDriveCredentials.json` in the project root
   - <https://console.cloud.google.com/apis/api/drive.googleapis.com>
   - <https://console.cloud.google.com/apis/credentials>
   - Make sure to set the redirect URI to `http://localhost:3000/oauth2callback` before downloading the JSON file
4. Copy `.env.example` to `.env` and fill in your:
   - Mealie API URL and key
   - Google Drive root folder ID

## Usage

Run the program using the root Google Drive folder ID, where file processing will start, set in the `.env` file:

```bash
npm start
```

You can also override the folder ID by passing it as an argument:

```bash
npm start <YOUR_FOLDER_ID>
```

The folder ID can be found in the Google Drive URL when viewing the folder.

The first time you run the program, it will open a browser window to authenticate with your Google account. You will have to allow for the "unsafe" app since it has not been reviewed by Google. After authentication, it will save the credentials in `googleDriveToken.json` for future use.

## Output

- Logs are written to `error.log` and `combined.log`
- Recipes in text-type files (txt, doc, docx, Docs, PDF, etc.) are uploaded to your Mealie instance (no image processing at the moment)
- Tags are added to the recipes based on the folder(s) where the recipe is located in Google Drive
- The environment variable `INCLUDE_ROOT_FOLDER_AS_TAG` can be set to `true` to include the root folder as a tag
- The tag `imported` is added to all recipes to indicate they were imported by this script
- You will need to manually reconcile/parse the ingredients, add cooking/prep times, and add images to the recipes in Mealie

## Error Handling

- Individual recipe processing failures are logged but won't stop the entire process
- API errors are logged with details
- Network issues are handled gracefully with retries where appropriate
