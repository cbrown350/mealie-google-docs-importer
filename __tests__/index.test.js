import { jest, describe, expect, it, afterEach, beforeEach } from '@jest/globals';
import process from 'process';

// Mock dependencies
jest.unstable_mockModule('../src/googleDrive.js', () => ({
  setupGoogleDrive: jest.fn(),
  getAllRecipeDocs: jest.fn()
}));

jest.unstable_mockModule('../src/mealie.js', () => ({
  uploadToMealie: jest.fn(),
  addRecipeTags: jest.fn()
}));

jest.unstable_mockModule('../src/utils.js', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  withRetry: jest.fn((fn) => fn())
}));

jest.unstable_mockModule('dotenv', () => ({
  default: {
    config: jest.fn()
  }
}));

// Import after mocks
const { setupGoogleDrive, getAllRecipeDocs } = await import('../src/googleDrive.js');
const { uploadToMealie, addRecipeTags } = await import("../src/mealie.js");


describe('Recipe Importer Top Level', () => {
  let originalEnv;
  let originalArgv
  let exitSpy;
  let main;

  beforeEach(async () => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'test-folder-id';
    originalArgv = process.argv;
    process.argv = ['node', 'src/index.js'];
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup default mock returns
    setupGoogleDrive.mockResolvedValue('mock-drive-client');
    getAllRecipeDocs.mockResolvedValue([]);
    uploadToMealie.mockResolvedValue({ id: 'recipe-id' });
    addRecipeTags.mockResolvedValue();    

    // Import the main function after setting up the environment and mocks
    //  Really only necessary once, but better to reset above for each test and not duplicate
    //   in BeforeAll block
    main = (await import('../src/index.js')).main;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    exitSpy.mockRestore();
  });
    

  it('should process recipes successfully', async () => {
    const mockRecipes = [
      { 
        name: 'Test Recipe 1',
        content: '<html>recipe1</html>',
        tags: ['tag1']
      },
      {
        name: 'Test Recipe 2',
        content: '<html>recipe2</html>',
        tags: []
      }
    ];

    getAllRecipeDocs.mockResolvedValue(mockRecipes);
    
    await main();

    expect(setupGoogleDrive).toHaveBeenCalled();
    expect(getAllRecipeDocs).toHaveBeenCalledWith('mock-drive-client', 'test-folder-id');
    expect(uploadToMealie).toHaveBeenCalledTimes(2);
    expect(addRecipeTags).toHaveBeenCalledTimes(2); // called twice due to 'imported' tag always added
  });

  it('should handle recipe processing errors', async () => {
    const mockRecipes = [{
      name: 'Failed Recipe',
      content: '<html>recipe</html>',
      tags: ['tag1']
    }];

    getAllRecipeDocs.mockResolvedValue(mockRecipes);
    uploadToMealie.mockRejectedValue(new Error('Upload failed'));

    await main();

    expect(setupGoogleDrive).toHaveBeenCalled();
    expect(getAllRecipeDocs).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled(); // Should continue despite individual recipe failures
  });

  it('should handle fatal errors', async () => {
    setupGoogleDrive.mockRejectedValue(new Error('Fatal error'));

    await main();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});


describe('Module-Level Tests', () => {
  // Separate test block since this tests the module-level behavior and must be run in isolation
  
  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();  
  });


  it('should exit if no folder ID is provided', async () => {
    // Setup environment before import
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    const originalArgv = process.argv;
    process.argv = ['node', 'src/index.js'];

    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    // Setup exit spy
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    
    // Import and execute
    const { main } = await import('../src/index.js');
    await main();
    
    // Assertions
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    // Cleanup
    process.env = originalEnv;
    process.argv = originalArgv;
    exitSpy.mockRestore();
  });
});