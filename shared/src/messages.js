"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageType = void 0;
exports.isMessage = isMessage;
exports.isMessageType = isMessageType;
exports.createMessage = createMessage;
exports.generateMessageId = generateMessageId;
exports.serializeMessage = serializeMessage;
exports.deserializeMessage = deserializeMessage;
/**
 * 消息类型枚举
 */
var MessageType;
(function (MessageType) {
    // 认证消息
    MessageType["AUTH"] = "auth";
    MessageType["AUTH_RESP"] = "auth_resp";
    // 控制消息
    MessageType["REGISTER"] = "register";
    MessageType["UNREGISTER"] = "unregister";
    MessageType["REGISTER_RESP"] = "register_resp";
    MessageType["HEARTBEAT"] = "heartbeat";
    MessageType["HEARTBEAT_RESP"] = "heartbeat_resp";
    // 连接通知
    MessageType["NEW_CONNECTION"] = "new_connection";
    MessageType["CONNECTION_CLOSE"] = "connection_close";
    MessageType["CONNECTION_ERROR"] = "connection_error";
})(MessageType || (exports.MessageType = MessageType = {}));
/**
 * 消息类型守卫
 */
function isMessage(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const msg = obj;
    return typeof msg.type === 'string' && typeof msg.id === 'string';
}
/**
 * 检查消息是否为指定类型
 */
function isMessageType(msg, type) {
    return msg.type === type;
}
/**
 * 创建消息
 */
function createMessage(type, payload, id) {
    return {
        type,
        id: id || generateMessageId(),
        payload,
    };
}
/**
 * 生成消息ID
 */
function generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
/**
 * 序列化消息
 */
function serializeMessage(msg) {
    return JSON.stringify(msg);
}
/**
 * 反序列化消息
 */
function deserializeMessage(data) {
    try {
        const msg = JSON.parse(data);
        if (!isMessage(msg)) {
            throw new Error('Invalid message format');
        }
        return msg;
    }
    catch (error) {
        throw new Error(`Failed to deserialize message: ${error}`);
    }
}
//# sourceMappingURL=messages.js.map