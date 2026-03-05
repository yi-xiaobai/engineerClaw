// 必须在最顶部加载环境变量
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

import Lark from "@larksuiteoapi/node-sdk";
import { wsClient, getAppAccessToken } from "./services/feishu.js";
import { handleMessage, handleBotAdded, handleBotRemoved } from "./handlers/message.js";

/**
 * 启动服务
 */
async function main() {
  console.log("🚀 启动飞书 Agent (WebSocket 模式)...");

  // 验证配置
  try {
    await getAppAccessToken();
    console.log("✅ 飞书应用凭证验证通过");
  } catch (error) {
    console.error("❌ 飞书应用凭证验证失败:", error.message);
    process.exit(1);
  }

  // 启动 WebSocket 客户端，使用 register 方法注册事件
  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        console.log("📩 收到消息事件");
        await handleMessage(data);
      },
      "im.chat.member.bot.created_v1": async (data) => {
        console.log("🤖 机器人被添加到群聊");
        await handleBotAdded(data.event);
      },
      "im.chat.member.bot.deleted_v1": async (data) => {
        console.log("👋 机器人被移出群聊");
        await handleBotRemoved(data.event);
      },
    }),
  });

  console.log("✅ 飞书 Agent 已启动，等待消息...");
}

main().catch(console.error);
