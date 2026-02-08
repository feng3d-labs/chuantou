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
const controller_js_1 = require("./controller.js");
const proxy_manager_js_1 = require("./proxy-manager.js");
const path = __importStar(require("path"));
/**
 * 主入口
 */
async function main() {
    console.log('Starting Zhuanfa Client...');
    // 加载配置
    const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'default.json');
    const config = await config_js_1.Config.fromFile(configPath);
    // 环境变量覆盖
    const envConfig = config_js_1.Config.fromEnv();
    Object.assign(config, envConfig);
    // 验证配置
    config.validate();
    console.log('Configuration loaded:');
    console.log(`  Server URL: ${config.serverUrl}`);
    console.log(`  Proxies: ${config.proxies.length} configured`);
    for (const proxy of config.proxies) {
        console.log(`    - ${proxy.protocol} :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`);
    }
    // 创建控制器
    const controller = new controller_js_1.Controller(config);
    // 创建代理管理器
    const proxyManager = new proxy_manager_js_1.ProxyManager(controller);
    // 监听控制器事件
    controller.on('connected', () => {
        console.log('Connected to server');
    });
    controller.on('disconnected', () => {
        console.log('Disconnected from server');
    });
    controller.on('authenticated', async () => {
        console.log('Authenticated, registering proxies...');
        // 注册所有代理
        for (const proxyConfig of config.proxies) {
            try {
                await proxyManager.registerProxy(proxyConfig);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`Failed to register proxy: ${errorMessage}`);
            }
        }
    });
    controller.on('maxReconnectAttemptsReached', () => {
        console.error('Max reconnect attempts reached, exiting...');
        process.exit(1);
    });
    // 优雅关闭
    process.on('SIGINT', async () => {
        console.log('\\nReceived SIGINT, shutting down gracefully...');
        await proxyManager.destroy();
        controller.disconnect();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.log('\\nReceived SIGTERM, shutting down gracefully...');
        await proxyManager.destroy();
        controller.disconnect();
        process.exit(0);
    });
    // 连接到服务器
    try {
        await controller.connect();
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Failed to connect to server:', errorMessage);
        process.exit(1);
    }
}
main().catch((error) => {
    console.error('Failed to start client:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map