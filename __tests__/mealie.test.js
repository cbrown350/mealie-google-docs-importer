import { jest } from '@jest/globals';
import { mockFetchResponse } from './test-helpers.js';

// Mock environment variables
process.env.MEALIE_API_URL = 'https://mealie.test';
process.env.MEALIE_API_KEY = 'test-key';

// Mock node-fetch module
jest.unstable_mockModule('node-fetch', () => ({
  default: jest.fn()
}));
// Dynamically import the modules since using jest.unstable_mockModule
const fetch = (await import("node-fetch")).default;
const { uploadToMealie, addRecipeTags, fetchMatchingTags, fetchAllExistingTags } = await import("../src/mealie.js");


describe('Mealie API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadToMealie', () => {
    it('should successfully upload a recipe', async () => {
      const mockRecipe = '<html><body>Test Recipe</body></html>';
      const mockResponse = { slug: 'test-recipe' };
      
      fetch.mockResolvedValueOnce(mockFetchResponse(mockResponse));

      const result = await uploadToMealie(mockRecipe, 'Test Recipe');
      
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        'https://mealie.test/api/recipes/create/html-or-json',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            includeTags: true,
            data: mockRecipe
          })
        })
      );
    });

    it('should handle upload errors', async () => {
      fetch.mockResolvedValueOnce(mockFetchResponse({}, false, 500));

      await expect(uploadToMealie('<html></html>', 'Test')).rejects.toThrow(/Mealie API error/);
    });
  });

  describe('addRecipeTags', () => {
    const mockRecipe = {
      groupId: 'test-group',
      tags: ['existing-tag']
    };
    const mockTag = {
      name: 'new-tag',
      slug: 'new-tag'
    };

    it('should add tags to a recipe', async () => {
      fetch
        .mockResolvedValueOnce(mockFetchResponse(mockRecipe)) // GET recipe
        .mockResolvedValueOnce(mockFetchResponse([...mockRecipe.tags])) // GET existing tags
        .mockResolvedValueOnce(mockFetchResponse(mockTag)) // POST new tag
        .mockResolvedValueOnce(mockFetchResponse({ 
          ...mockRecipe,
          tags: [...mockRecipe.tags, mockTag.name]
        })); // PATCH recipe

      const result = await addRecipeTags('test-recipe', [mockTag.name]);
      
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(result.tags).toContain(mockTag.name);
    });

    it('should handle missing recipe', async () => {
      fetch.mockResolvedValueOnce(mockFetchResponse({}, false, 404));

      await expect(addRecipeTags('missing-recipe', ['tag'])).rejects.toThrow();
    });

    it('should skip if no tags provided', async () => {
      const result = await addRecipeTags('test-recipe', []);
      
      expect(result).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('fetchMatchingTags', () => {
    it('should return empty array for no tags', async () => {
      const result = await fetchMatchingTags([]);
      expect(result).toEqual([]);
    });

    it('should match existing tags and create new ones', async () => {
      const existingTag = { id: '1', name: 'existing', slug: 'existing' };
      const newTag = { id: '2', name: 'new', slug: 'new' };

      fetch
        .mockResolvedValueOnce(mockFetchResponse({ items: [existingTag] })) // GET all tags
        .mockResolvedValueOnce(mockFetchResponse(newTag)); // POST new tag

      const result = await fetchMatchingTags(['existing', 'new']);
      
      expect(result).toEqual([existingTag, newTag]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchExistingTags', () => {
    it('should fetch all tags from Mealie', async () => {
      const mockTags = [
        { id: '1', name: 'tag1' },
        { id: '2', name: 'tag2' }
      ];

      fetch.mockResolvedValueOnce(mockFetchResponse({ items: mockTags }));

      const result = await fetchAllExistingTags();
      
      expect(result).toEqual(mockTags);
      expect(fetch).toHaveBeenCalledWith(
        'https://mealie.test/api/organizers/tags',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-key',
            'Content-Type': 'application/json',
          }
        })
      );
    });

    it('should handle fetch errors', async () => {
      fetch.mockResolvedValueOnce(mockFetchResponse({}, false, 500));

      await expect(fetchAllExistingTags()).rejects.toThrow();
    });
  });
});