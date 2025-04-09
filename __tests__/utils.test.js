import { jest, describe, it, expect } from '@jest/globals';
import { createLogger, withRetry } from '../src/utils.js';
import winston from 'winston';

describe('Utils', () => {
  describe('createLogger', () => {
    it('should create a winston logger instance', () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should properly format logs with additional data objects', () => {
      const logger = createLogger();
      const mockConsoleTransport = {
        log: jest.fn()
      };
  
      // Replace existing transports with our mock
      logger.clear();
      logger.add(new winston.transports.Console({
        log: mockConsoleTransport.log
      }));
  
      const timestamp = new Date('2025-04-09T06:43:16.224Z');
      const additionalData = {
        user: { id: 123, name: 'Test User' },
        metadata: { timestamp, status: 'active' }
      };
  
      logger.info('Test message', additionalData);
  
      const expectedInspectedData = expect.stringContaining(
        'user: { id: 123, name: \'Test User\' }'
      );
  
      expect(mockConsoleTransport.log).toHaveBeenCalledWith(
        {
          level: 'info',
          message: 'Test message',
          timestamp: expect.any(String),
          metadata: {
            status: 'active',
            timestamp
          },
          user: {
            id: 123,
            name: 'Test User'
          },
          [Symbol.for('level')]: 'info',
          [Symbol.for('splat')]: [additionalData],
          [Symbol.for('message')]: expect.stringMatching(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[info\]: Test message/),
          additionalInfo: [expectedInspectedData]
        },
        expect.anything() // Handle the additional function parameter
      );
    });
  });

  describe('withRetry', () => {
    it('should return result on successful operation', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await withRetry(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await withRetry(operation, 3, 100);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always fail'));

      await expect(withRetry(operation, 2, 100)).rejects.toThrow('Always fail');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });
});