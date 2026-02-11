/**
 * @module logger
 *
 * 日志工具模块，提供带时间戳的日志输出功能。
 */

/**
 * 格式化当前时间为日志时间戳
 *
 * @returns 格式化的时间字符串，格式为 HH:MM:SS.mmm
 */
function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * 带时间戳的日志工具
 */
export const logger = {
  /**
   * 输出信息日志
   *
   * @param message - 日志消息
   */
  log: (...message: unknown[]): void => {
    console.log(`[${formatTimestamp()}]`, ...message);
  },

  /**
   * 输出信息日志（别名）
   *
   * @param message - 日志消息
   */
  info: (...message: unknown[]): void => {
    console.log(`[${formatTimestamp()}]`, ...message);
  },

  /**
   * 输出警告日志
   *
   * @param message - 日志消息
   */
  warn: (...message: unknown[]): void => {
    console.warn(`[${formatTimestamp()}]`, ...message);
  },

  /**
   * 输出错误日志
   *
   * @param message - 日志消息
   */
  error: (...message: unknown[]): void => {
    console.error(`[${formatTimestamp()}]`, ...message);
  },
};
