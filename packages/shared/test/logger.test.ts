/**
 * @module logger.test
 * @description 日志工具模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from '../src/logger.js';

describe('logger', () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('log', () => {
    it('should log messages with timestamp', () => {
      logger.log('Test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });

    it('should log multiple arguments', () => {
      logger.log('Message', 'arg1', 'arg2', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/),
        'Message',
        'arg1',
        'arg2',
        { key: 'value' }
      );
    });

    it('should handle empty log', () => {
      logger.log();

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('info', () => {
    it('should log info messages with timestamp', () => {
      logger.info('Info message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });

    it('should log multiple info arguments', () => {
      logger.info('Info', 123, true, { data: 'test' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/),
        'Info',
        123,
        true,
        { data: 'test' }
      );
    });
  });

  describe('warn', () => {
    it('should log warning messages with timestamp', () => {
      logger.warn('Warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });

    it('should log warning with console.warn', () => {
      logger.warn('Warning', 'details');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/),
        'Warning',
        'details'
      );
    });
  });

  describe('error', () => {
    it('should log error messages with timestamp', () => {
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });

    it('should log error with details', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/),
        'Error occurred',
        error
      );
    });

    it('should log error objects', () => {
      logger.error({ error: 'details', code: 500 });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/),
        { error: 'details', code: 500 }
      );
    });
  });

  describe('timestamp format', () => {
    it('should use HH:MM:SS.mmm format', () => {
      logger.log('Test');

      const timestamp = consoleLogSpy.mock.calls[0][0];
      // 格式: [HH:MM:SS.mmm]
      expect(timestamp).toMatch(/^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]$/);

      // 验证时间范围
      const match = timestamp.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]$/);
      if (match) {
        const [, hours, minutes, seconds, ms] = match;
        expect(parseInt(hours, 10)).toBeGreaterThanOrEqual(0);
        expect(parseInt(hours, 10)).toBeLessThanOrEqual(23);
        expect(parseInt(minutes, 10)).toBeGreaterThanOrEqual(0);
        expect(parseInt(minutes, 10)).toBeLessThanOrEqual(59);
        expect(parseInt(seconds, 10)).toBeGreaterThanOrEqual(0);
        expect(parseInt(seconds, 10)).toBeLessThanOrEqual(59);
        expect(parseInt(ms, 10)).toBeGreaterThanOrEqual(0);
        expect(parseInt(ms, 10)).toBeLessThanOrEqual(999);
      }
    });
  });
});
