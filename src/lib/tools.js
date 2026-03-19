/**
 * lib/tools.js - 通用工具函数
 * 
 * 供各个 Agent 复用的工具函数
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

export const execAsync = promisify(exec);

/**
 * 创建安全路径检查函数
 * @param {string} basePath - 基础路径
 * @returns {function} - 路径检查函数
 */
export function createSafePath(basePath) {
  return (p) => {
    const fullPath = path.resolve(basePath, p);
    if (!fullPath.startsWith(basePath)) {
      throw new Error(`Path escapes workspace: ${p}`);
    }
    return fullPath;
  };
}

/**
 * 执行 shell 命令
 * @param {string} command - 命令
 * @param {string} cwd - 工作目录
 * @param {object} options - 选项
 */
export async function runCommand(command, cwd, options = {}) {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot"];
  if (dangerous.some(d => command.includes(d))) {
    return "Error: Dangerous command blocked";
  }
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: options.timeout || 60000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 5
    });
    const output = (stdout + stderr).trim();
    return output.slice(0, options.maxOutput || 30000) || "(no output)";
  } catch (error) {
    if (error.killed) {
      return "Error: Command timeout";
    }
    return `Error: ${error.message}`;
  }
}

/**
 * 读取文件
 * @param {string} filePath - 文件路径
 * @param {number} limit - 最大行数
 */
export async function readFile(filePath, limit = null) {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    let lines = text.split("\n");
    if (limit && limit < lines.length) {
      lines = [...lines.slice(0, limit), `... (${lines.length - limit} more)`];
    }
    return lines.join("\n").slice(0, 30000);
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 写入文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 内容
 */
export async function writeFile(filePath, content) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 编辑文件（替换文本）
 * @param {string} filePath - 文件路径
 * @param {string} oldText - 原文本
 * @param {string} newText - 新文本
 */
export async function editFile(filePath, oldText, newText) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${filePath}`;
    }
    const newContent = content.replace(oldText, newText);
    await fs.writeFile(filePath, newContent, "utf-8");
    return `Edited ${filePath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 搜索代码
 * @param {string} keyword - 关键词
 * @param {string} projectPath - 项目路径
 * @param {string} filePattern - 文件模式
 */
export async function searchCode(keyword, projectPath, filePattern = null) {
  try {
    let cmd = `grep -rn "${keyword}" "${projectPath}"`;
    if (filePattern) {
      cmd += ` --include="${filePattern}"`;
    }
    cmd += ` --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git | head -30`;

    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    return stdout.trim() || `No results for: ${keyword}`;
  } catch (error) {
    if (error.code === 1) {
      return `No results for: ${keyword}`;
    }
    return `Error: ${error.message}`;
  }
}

/**
 * 创建 Anthropic 客户端
 */
export function createAnthropicClient(Anthropic, anthropicConfig) {
  return new Anthropic({
    baseURL: anthropicConfig.baseURL,
    apiKey: anthropicConfig.apiKey,
  });
}

/**
 * Agent 循环执行
 * @param {object} client - Anthropic 客户端
 * @param {object} options - 选项
 */
export async function runAgentLoop(client, options) {
  const {
    model,
    system,
    messages,
    tools,
    handlers,
    maxIterations = 10,
    maxTokens = 4000,
    onToolCall = () => {}
  } = options;

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      system,
      messages,
      tools,
      max_tokens: maxTokens
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const textBlocks = response.content.filter(b => b.type === "text");
      return textBlocks.map(b => b.text).join("\n");
    }

    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const handler = handlers[block.name];
        let output;
        try {
          output = handler ? await handler(block.input) : `Unknown tool: ${block.name}`;
        } catch (e) {
          output = `Error: ${e.message}`;
        }

        onToolCall(block.name, block.input, output);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output)
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return null;
}
