import { sendTextMessage } from "../services/feishu.js";
import { processMessage, clearSession, getSession } from "../services/agent.js";
import { setWorkspace } from "../services/agent.js";

// 设置工作目录
const WORKDIR = "/Users/luoyi/Documents/1_project";
setWorkspace(WORKDIR);

/**
 * 处理飞书消息事件
 * @param {object} data - 消息事件数据
 */
export async function handleMessage(data) {
  const { message, sender } = data;
  const chatId = message.chat_id;
  const messageType = message.message_type;

  // 只处理文本消息
  if (messageType !== "text") {
    await sendTextMessage(chatId, "目前只支持文本消息哦~");
    return;
  }

  // 解析消息内容
  let userText;
  try {
    const content = JSON.parse(message.content);
    userText = content.text;
  } catch {
    userText = message.content;
  }

  // 去除 @机器人的部分
  userText = userText.replace(/@_user_\d+/g, "").trim();

  if (!userText) return;

  console.log(`\n📩 收到消息 [${chatId}]: ${userText}`);

  // 特殊命令处理
  if (userText === "/clear" || userText === "清空") {
    clearSession(chatId);
    await sendTextMessage(chatId, "✅ 对话历史已清空");
    return;
  }

  if (userText === "/help" || userText === "帮助") {
    await sendTextMessage(
      chatId,
      `🤖 Claude Agent 帮助

命令：
- /clear - 清空对话历史
- /help - 显示帮助

你可以让我帮你：
- 查看文件内容
- 执行 shell 命令
- 分析代码
- 等等...`
    );
    return;
  }

  // 发送"正在处理"提示
  await sendTextMessage(chatId, "🤔 正在思考...");

  try {
    // 运行 Agent（带会话管理）
    const response = await processMessage(userText, chatId);

    // 飞书消息有长度限制，需要截断
    let finalResponse = response;
    if (response.length > 4000) {
      finalResponse = response.slice(0, 3900) + "\n\n... (内容过长，已截断)";
    }

    await sendTextMessage(chatId, finalResponse);
    console.log(`✅ 已回复 [${chatId}]`);
  } catch (error) {
    console.error("Agent 执行错误:", error);
    await sendTextMessage(chatId, `❌ 执行出错: ${error.message}`);
  }
}

/**
 * 处理机器人被添加到群聊事件
 * @param {object} event - 事件对象
 */
export async function handleBotAdded(event) {
  const chatId = event.chat_id;
  console.log(`机器人被添加到群聊: ${chatId}`);

  await sendTextMessage(
    chatId,
    `你好！我是 AI 助手

命令：
- /clear - 清空对话历史
- /help - 显示帮助

有什么可以帮你的吗？`
  );
}

/**
 * 处理机器人被移出群聊事件
 * @param {object} event - 事件对象
 */
export async function handleBotRemoved(event) {
  const chatId = event.chat_id;
  console.log(`机器人被移出群聊: ${chatId}`);
  // 清理会话
  clearSession(chatId);
}
