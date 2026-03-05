import Anthropic from "@anthropic-ai/sdk";
import config from "../config/index.js";
import { TOOLS } from "../tools/definitions.js";
import { TOOL_HANDLERS } from "../tools/handlers.js";
import { setWorkDir } from "../tools/index.js";

const { anthropic: anthropicConfig } = config;

// 初始化 Anthropic 客户端
const client = new Anthropic({
  baseURL: anthropicConfig.baseURL,
  apiKey: anthropicConfig.apiKey,
});

const SYSTEM = `你是一个编程助手，使用提供的工具来完成任务。行动而不是解释。`;

// ============ 会话管理 ============
const sessions = new Map();

/**
 * 获取或创建会话
 * @param {string} chatId - 会话 ID（用户 ID 或群聊 ID）
 */
export function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { history: [], lastActive: Date.now() });
  }
  const session = sessions.get(chatId);
  session.lastActive = Date.now();
  return session;
}

/**
 * 清理不活跃的会话（超过1小时）
 */
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (now - session.lastActive > 3600000) {
      sessions.delete(chatId);
    }
  }
}, 600000);

/**
 * 清空会话历史
 */
export function clearSession(chatId) {
  sessions.delete(chatId);
}

/**
 * 获取所有会话
 */
export function getAllSessions() {
  return sessions;
}

/**
 * Agent 核心循环
 * @param {Array} messages - 消息历史
 * @returns {Promise<{text: string, toolLogs: Array}>} - 响应文本和工具日志
 */
export async function agentLoop(messages) {
  const toolLogs = [];

  while (true) {
    const response = await client.messages.create({
      model: anthropicConfig.model,
      system: SYSTEM,
      messages: messages,
      tools: TOOLS,
      max_tokens: 8000,
    });

    messages.push({ role: "assistant", content: response.content });

    // 如果模型没有调用工具，返回最终回复
    if (response.stop_reason !== "tool_use") {
      const textBlocks = response.content.filter((block) => block.type === "text");
      const text = textBlocks.map((b) => b.text).join("\n");
      return { text, toolLogs };
    }

    // 执行工具调用
    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const handler = TOOL_HANDLERS[block.name];
        const output = handler
          ? await handler(block.input)
          : `Unknown tool: ${block.name}`;

        toolLogs.push(`$ ${block.name}: ${output.slice(0, 100)}...`);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      }
    }

    messages.push({ role: "user", content: results });
  }
}

/**
 * 处理用户消息（带会话管理）
 * @param {string} message - 用户消息
 * @param {string} chatId - 会话 ID
 * @returns {Promise<string>} - 最终响应
 */
export async function processMessage(message, chatId) {
  const session = getSession(chatId);

  // 添加用户消息到历史
  session.history.push({ role: "user", content: message });

  // 运行 Agent
  const { text, toolLogs } = await agentLoop([...session.history]);

  // 添加助手回复到历史
  session.history.push({ role: "assistant", content: text });

  // 限制历史长度
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }

  // 构建响应
  let response = "";
  if (toolLogs.length > 0) {
    response += "📋 执行记录:\n```\n" + toolLogs.join("\n") + "\n```\n\n";
  }
  response += text || "(无回复)";

  return response;
}

/**
 * 处理单次消息（无会话状态）
 * @param {string} message - 用户消息
 * @param {string} userId - 用户 ID
 * @returns {Promise<string>} - 最终响应
 */
export async function processSingleMessage(message, userId) {
  const messages = [{ role: "user", content: message }];
  const { text } = await agentLoop(messages);
  return text || "(无回复)";
}

/**
 * 设置工作目录
 */
export function setWorkspace(dir) {
  setWorkDir(dir);
}
