import { jest } from '@jest/globals';
import { mockGoogleDriveFile } from './test-helpers.js';

// Mock googleapis
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn(),
      fromJSON: jest.fn()
    },
    drive: jest.fn()
  }
}));
// Dynamically import the modules since using jest.unstable_mockModule
const { setupGoogleDrive, getAllRecipeDocs } = await import('../src/googleDrive.js');

// Mock fs/promises
jest.unstable_mockModule('fs/promises', () => ({
  default: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    access: jest.fn(),
    unlink: jest.fn()
  }
}));

const { google } = await import('googleapis');
const fs = (await import('fs/promises')).default;

describe('Google Drive', () => {
  const mockDrive = {
    files: {
      get: jest.fn(),
      list: jest.fn(),
      export: jest.fn()
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    google.drive.mockReturnValue(mockDrive);
  });

  describe('setupGoogleDrive', () => {
    it('should setup Google Drive client with saved credentials', async () => {
      const mockCredentials = { credentials: { refresh_token: 'test-token' } };
      fs.access.mockResolvedValue(true);
      fs.readFile.mockResolvedValue(JSON.stringify(mockCredentials));
      google.auth.fromJSON.mockReturnValue(mockCredentials);
      mockDrive.files.list.mockResolvedValue({ data: { files: [] } });

      const result = await setupGoogleDrive();

      expect(result).toBe(mockDrive);
      expect(google.drive).toHaveBeenCalledWith({
        version: 'v3',
        auth: mockCredentials
      });
    });
  });

  describe('getAllRecipeDocs', () => {
    const mockFolder = mockGoogleDriveFile('Test Folder', 'application/vnd.google-apps.folder');
    const mockDoc = mockGoogleDriveFile(
      'Test Recipe',
      'application/vnd.google-apps.document',
      'Recipe content'
    );

    beforeEach(() => {
      // Mock folder name lookup
      mockDrive.files.get.mockResolvedValue({
        data: { name: mockFolder.name }
      });
    });

    it('should recursively get all recipes from folders', async () => {
      process.env.INCLUDE_ROOT_FOLDER_AS_TAG = 'true';
      // Mock folder contents
      mockDrive.files.list.mockResolvedValue({
        data: { files: [mockDoc] }
      });

      // Mock document content export
      mockDrive.files.export.mockResolvedValue({
        data: mockDoc.content
      });

      const recipes = await getAllRecipeDocs(mockDrive, 'test-folder-id');

      expect(recipes).toHaveLength(1);
      expect(recipes[0]).toEqual({
        name: mockDoc.name,
        content: mockDoc.content,
        mimeType: mockDoc.mimeType,
        tags: [mockFolder.name]
      });
    });

    it('should handle root folder tag inclusion setting', async () => {
      process.env.INCLUDE_ROOT_FOLDER_AS_TAG = 'false';
      
      mockDrive.files.list.mockResolvedValue({
        data: { files: [mockDoc] }
      });
      mockDrive.files.export.mockResolvedValue({
        data: mockDoc.content
      });

      const recipes = await getAllRecipeDocs(mockDrive, 'test-folder-id');

      expect(recipes[0].tags).toHaveLength(0);
    });

    it('should handle unsupported file types', async () => {
      const mockUnsupportedFile = mockGoogleDriveFile(
        'Unsupported',
        'application/unsupported'
      );

      mockDrive.files.list.mockResolvedValue({
        data: { files: [mockUnsupportedFile] }
      });

      const recipes = await getAllRecipeDocs(mockDrive, 'test-folder-id');

      expect(recipes).toHaveLength(0);
    });

    it('should handle file processing errors', async () => {
      mockDrive.files.list.mockResolvedValue({
        data: { files: [mockDoc] }
      });
      mockDrive.files.export.mockRejectedValue(new Error('Export failed'));

      const recipes = await getAllRecipeDocs(mockDrive, 'test-folder-id');

      expect(recipes).toHaveLength(0);
    });
  });
describe('getAllRecipeDocs with nested folders', () => {
  const mockRootFolder = mockGoogleDriveFile('Root Folder', 'application/vnd.google-apps.folder');
  const mockSubFolder = mockGoogleDriveFile('Sub Folder', 'application/vnd.google-apps.folder');
  const mockDoc = mockGoogleDriveFile(
    'Test Recipe',
    'application/vnd.google-apps.document',
    'Recipe content'
  );

  it('should process nested folder structure', async () => {
    // Mock root folder name lookup
    mockDrive.files.get
      .mockResolvedValueOnce({ data: { name: mockRootFolder.name } })
      .mockResolvedValueOnce({ data: { name: mockSubFolder.name } });

    // Mock folder contents - root contains subfolder, subfolder contains doc
    mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [mockSubFolder] } })
      .mockResolvedValueOnce({ data: { files: [mockDoc] } });

    mockDrive.files.export.mockResolvedValue({ data: mockDoc.content });

    process.env.INCLUDE_ROOT_FOLDER_AS_TAG = 'true';
    const recipes = await getAllRecipeDocs(mockDrive, 'root-folder-id');

    expect(recipes).toHaveLength(1);
    expect(recipes[0].tags).toEqual([mockRootFolder.name, mockSubFolder.name]);
    expect(mockDrive.files.list).toHaveBeenCalledTimes(2);
  });

  it('should handle empty folders', async () => {
    mockDrive.files.get.mockResolvedValue({ data: { name: mockRootFolder.name } });
    mockDrive.files.list.mockResolvedValue({ data: { files: [] } });

    const recipes = await getAllRecipeDocs(mockDrive, 'empty-folder-id');

    expect(recipes).toHaveLength(0);
    expect(mockDrive.files.list).toHaveBeenCalledTimes(1);
  });

  it('should handle mixed content types in folders', async () => {
    const mockPdf = mockGoogleDriveFile('Recipe.pdf', 'application/pdf', 'PDF content');
    const mockUnsupported = mockGoogleDriveFile('unsupported.xyz', 'application/unknown');

    mockDrive.files.get.mockResolvedValue({ data: { name: mockRootFolder.name } });
    mockDrive.files.list.mockResolvedValue({
      data: { files: [mockDoc, mockPdf, mockUnsupported] }
    });

    mockDrive.files.export.mockResolvedValue({ data: mockDoc.content });
    mockDrive.files.get.mockResolvedValue({ data: mockPdf.content });

    const recipes = await getAllRecipeDocs(mockDrive, 'mixed-folder-id');

    // Should only process supported file types
    expect(recipes).toHaveLength(1);
  });

  it('should handle errors in folder name retrieval', async () => {
    mockDrive.files.get.mockRejectedValue(new Error('Folder not found'));
    mockDrive.files.list.mockResolvedValue({ data: { files: [mockDoc] } });

    const recipes = await getAllRecipeDocs(mockDrive, 'invalid-folder-id');

    expect(recipes[0].tags).toHaveLength(0);
    expect(mockDrive.files.get).toHaveBeenCalled();
  });

  it('should process multiple files in multiple folders', async () => {
    const mockDoc2 = mockGoogleDriveFile(
      'Recipe 2',
      'application/vnd.google-apps.document',
      'Recipe 2 content'
    );

    mockDrive.files.get
      .mockResolvedValueOnce({ data: { name: mockRootFolder.name } })
      .mockResolvedValueOnce({ data: { name: mockSubFolder.name } });

    mockDrive.files.list
      .mockResolvedValueOnce({ data: { files: [mockDoc, mockSubFolder] } })
      .mockResolvedValueOnce({ data: { files: [mockDoc2] } });

    mockDrive.files.export
      .mockResolvedValueOnce({ data: mockDoc.content })
      .mockResolvedValueOnce({ data: mockDoc2.content });

    process.env.INCLUDE_ROOT_FOLDER_AS_TAG = 'true';
    const recipes = await getAllRecipeDocs(mockDrive, 'root-folder-id');

    expect(recipes).toHaveLength(2);
    expect(recipes[0].tags).toEqual([mockRootFolder.name]);
    expect(recipes[1].tags).toEqual([mockRootFolder.name, mockSubFolder.name]);
  });

  it('should handle errors in file content retrieval', async () => {
    mockDrive.files.get.mockResolvedValue({ data: { name: mockRootFolder.name } });
    mockDrive.files.list.mockResolvedValue({ data: { files: [mockDoc] } });
    mockDrive.files.export.mockRejectedValue(new Error('Content extraction failed'));

    const recipes = await getAllRecipeDocs(mockDrive, 'root-folder-id');

    expect(recipes).toHaveLength(0);
    expect(mockDrive.files.export).toHaveBeenCalled();
  });
});
});