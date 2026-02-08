"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const config_js_1 = require("./config.js");
const server_js_1 = require("./server.js");
const path = __importStar(require("path"));
/**
 * 主入口
 */
async function main() {
    console.log('Starting Zhuanfa Server...');
    // 加载配置
    const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'default.json');
    const config = await config_js_1.Config.fromFile(configPath);
    // 环境变量覆盖
    const envConfig = config_js_1.Config.fromEnv();
    Object.assign(config, envConfig);
    // 验证配置
    config.validate();
    console.log('Configuration loaded:');
    console.log(`  Control port: ${config.controlPort}`);
    console.log(`  Auth tokens: ${config.authTokens.length} configured`);
    console.log(`  Heartbeat interval: ${config.heartbeatInterval}ms`);
    console.log(`  Session timeout: ${config.sessionTimeout}ms`);
    // 创建并启动服务器
    const server = new server_js_1.ForwardServer(config);
    // 优雅关闭
    process.on('SIGINT', async () => {
        console.log('\\nReceived SIGINT, shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.log('\\nReceived SIGTERM, shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });
    // 启动服务器
    await server.start();
    console.log('Server started successfully');
}
main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map