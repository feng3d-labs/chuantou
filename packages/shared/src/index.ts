/**
 * @module shared
 *
 * 穿透代理共享模块入口。
 *
 * 本模块统一导出穿透代理系统中客户端与服务端共用的所有类型定义、
 * 消息结构、协议常量和工具函数，作为 `@chuantou/shared` 包的公共 API 入口。
 */

/** 导出所有消息类型、消息接口及消息工具函数 */
export * from './messages.js';
/** 导出协议常量、错误码、默认配置及各类配置接口 */
export * from './protocol.js';
/** 导出日志工具 */
export * from './logger.js';
/** 导出数据通道二进制帧协议工具 */
export * from './data-channel.js';
