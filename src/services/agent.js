import Anthropic from "@anthropic-ai/sdk";
import config from "../config/index.js";
import { TOOLS } from "../tools/definitions.js";
import { TOOL_HANDLERS } from "../tools/handlers.js";
import { setWorkDir } from "../tools/index.js";
import { skillLoader } from "../utils/skills.js";
import { mcpManager } from "./mcp-client.js";

const { anthropic: anthropicConfig } = config;

// 初始化 Anthropic 客户端
const client = new Anthropic({
  baseURL: anthropicConfig.baseURL,
  apiKey: anthropicConfig.apiKey,
});

// Layer 1: 简洁的系统提示词 + Skills 元数据
const SYSTEM = `你是一个强大的编程助手,可以帮助用户完成完整的开发工作流。

核心能力:
- 项目管理 - 扫描、切换项目,支持多项目搜索
- 代码搜索 - 在单个或多个项目中搜索代码
- 文件操作 - 读取、编辑、删除文件
- Git 操作 - 查看状态、创建分支、提交、推送
- GitLab 集成 - 创建 MR、获取版本信息
- IDE 集成 - 在 Windsurf 或 Cursor 中打开项目
- GitHub MCP - 通过 MCP 协议访问 GitHub API（工具名以 mcp_github__ 开头）

专业技能 (使用 load_skill 按需加载):
${skillLoader.getDescriptions()}

重要原则:
- 遇到复杂任务时,先使用 load_skill 加载相关专业知识
- 始终主动完成任务,不要等待用户多次确认
- 在执行危险操作前要谨慎
- 提供清晰的执行日志,让用户了解进度
- MCP 工具（mcp_github__*）提供完整的 GitHub 操作能力

行动而不是解释。`;

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
    // 合并本地工具 + MCP 工具
    const allTools = [...TOOLS, ...mcpManager.getAllTools()];

    const response = await client.messages.create({
      model: anthropicConfig.model,
      system: SYSTEM,
      messages: messages,
      tools: allTools,
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
        let output;

        // 判断是 MCP 工具还是本地工具
        if (mcpManager.isMCPTool(block.name)) {
          output = await mcpManager.callTool(block.name, block.input);
        } else {
          const handler = TOOL_HANDLERS[block.name];
          output = handler
            ? await handler(block.input)
            : `Unknown tool: ${block.name}`;
        }

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
