import * as Lark from "@larksuiteoapi/node-sdk";
import config from "../config/index.js";

const { feishu: feishuConfig } = config;

// 初始化飞书客户端
const larkClient = new Lark.Client({
  appId: feishuConfig.appId,
  appSecret: feishuConfig.appSecret,
});

// 初始化 WebSocket 客户端
const wsClient = new Lark.WSClient({
  appId: feishuConfig.appId,
  appSecret: feishuConfig.appSecret,
  loggerLevel: Lark.LoggerLevel.info,
});

// 缓存 Access Token
let appAccessToken = "";
let tokenExpireTime = 0;

/**
 * 获取应用 Access Token
 */
export async function getAppAccessToken() {
  const now = Date.now();
  if (appAccessToken && now < tokenExpireTime - 60) {
    return appAccessToken;
  }

  // console.log("获取 Token, appId:", feishuConfig.appId, "appSecret:", feishuConfig.appSecret?.slice(0, 5) + "...");

  const response = await larkClient.auth.v3.tenantAccessToken.internal({
    data: {
      app_id: feishuConfig.appId,
      app_secret: feishuConfig.appSecret,
    },
  });

  // console.log("Token response:", response);

  if (response.code === 0) {
    appAccessToken = response.tenant_access_token;
    tokenExpireTime = now + response.expire * 1000;
    console.log("✅ Token 获取成功");
    return appAccessToken;
  }
  throw new Error(`获取 Access Token 失败: ${response.msg}`);
}

/**
 * 发送文本消息
 * @param {string} receiveId - 接收者 ID（用户 ID 或群聊 ID）
 * @param {string} text - 文本内容
 */
export async function sendTextMessage(receiveId, text) {
  const isGroupChat = receiveId.startsWith("oc_");

  try {
    await larkClient.im.v1.message.create({
      params: {
        receive_id_type: isGroupChat ? "chat_id" : "user_id",
      },
      data: {
        receive_id: receiveId,
        content: JSON.stringify({ text }),
        msg_type: "text",
      },
    });
  } catch (error) {
    console.error("发送消息失败:", error.message);
  }
}

/**
 * 获取用户信息
 * @param {string} userId - 用户 ID
 */
export async function getUserInfo(userId) {
  const response = await larkClient.contact.v3.users.getUser({
    path: { user_id: userId },
  });
  return response.data;
}

/**
 * 获取群聊信息
 * @param {string} chatId - 群聊 ID
 */
export async function getChatInfo(chatId) {
  const response = await larkClient.im.v1.chats.getChat({
    path: { chat_id: chatId },
  });
  return response.data;
}

/**
 * 获取飞书客户端实例
 */
export function getLarkClient() {
  return larkClient;
}

/**
 * 获取 WebSocket 客户端实例
 */
export function getWSClient() {
  return wsClient;
}

export { larkClient, wsClient };
