import {jest} from '@jest/globals';

let mockOutputFile;

beforeEach(async () => {
  mockOutputFile = JSON.parse(
    await fs.readFile(new URL('../../output/sara’s taco soup.json', import.meta.url), 'utf-8')
  );
});

// Mock the OpenAI and fs modules
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn(() => ({
      chat: {
        completions: {
          create: jest.fn(() => Promise.resolve({
            model: 'gpt-4',
            usage: { total_tokens: 500 },
            choices: [{
              message: {
                content: JSON.stringify(mockOutputFile)
              }
            }]
          }))
        }
      }
    }))
  };
});

jest.mock('fs/promises', () => ({
  writeFile: jest.fn(() => Promise.resolve())
}));

jest.mock('../utils.js', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    error: jest.fn()
  }))
}));

import fs from 'fs/promises';
import { processRecipeText } from '../openAI.js';
import { tacoSoupData } from './testData.js';
import OpenAI from 'openai';



const mockRecipeResponse = {
  name: "Sara's Taco Soup",
  keywords: ["SOUP", "MEXICAN"],
  recipeIngredient: ["ingredient1", "ingredient2"],
  recipeInstructions: ["step1", "step2"]
};

describe('OpenAI Recipe Processing', () => {
    let mockOpenAICreate;

    beforeEach(() => {
        jest.clearAllMocks();
        // process.env.OPENAI_MODEL = 'gpt-4';
        // process.env.OPENAI_API_KEY = 'test-key';
        
        // // Get reference to mock create function
        // mockOpenAICreate = (new OpenAI({
        //   apiKey: process.env.OPENAI_API_KEY,
        // })).chat.completions.create;
        
        // // Setup default mock response
        // mockOpenAICreate.mockResolvedValue({
        //     model: 'gpt-4',
        //     usage: { total_tokens: 500 },
        //     choices: [{
        //         message: {
        //             content: JSON.stringify(mockRecipeResponse)
        //         }
        //     }]
        // });

        // fs.readFile.mockResolvedValue(JSON.stringify(mockRecipeResponse));
    });


  test('processRecipeText should process and save taco soup recipe', async () => {
    const tags = ['SOUP'];
    
    const result = await processRecipeText(tacoSoupData, tags);
    

  //   expect(mockOpenAICreate).toHaveBeenCalledWith(expect.objectContaining({
  //     model: 'gpt-4',
  //     messages: expect.arrayContaining([
  //         expect.objectContaining({ role: 'system' }),
  //         expect.objectContaining({ 
  //             role: 'user',
  //             content: expect.stringContaining('SOUP')
  //         })
  //     ]),
  //     temperature: 0.3
  // }));
    
    // Check if result has expected properties
    expect(result).toHaveProperty('name', 'Sara\'s Taco Soup');
    expect(result).toHaveProperty('keywords');
    expect(result.keywords).toContain('SOUP');
    expect(result).toHaveProperty('recipeIngredient');
    expect(result).toHaveProperty('recipeInstructions');
    
    // Check if writeFile was called with correct params
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('sara-s-taco-soup.json'),
      expect.any(String)
    );
  });
});
