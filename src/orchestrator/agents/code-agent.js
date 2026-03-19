/**
 * code-agent.js - 代码修改子 Agent
 * 
 * 负责根据 PRD 需求修改代码
 */

import Anthropic from "@anthropic-ai/sdk";
import config from "../../config/index.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);
const { anthropic: anthropicConfig } = config;

const client = new Anthropic({
  baseURL: anthropicConfig.baseURL,
  apiKey: anthropicConfig.apiKey,
});

const SYSTEM = `你是一个高级前端工程师，专注于 Vue.js 项目开发。你的任务是：
1. 根据需求分析代码结构
2. 定位需要修改的文件
3. 实施代码修改
4. 确保代码风格一致

工作原则：
- 先搜索和阅读相关代码，理解上下文
- 修改尽量最小化，只改必要的部分
- 保持原有代码风格
- 不要删除注释和文档

完成后，返回修改的文件列表。`;

/**
 * 创建工具定义
 */
function createTools(projectPath) {
  return [
    {
      name: "bash",
      description: "执行 shell 命令",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" }
        },
        required: ["command"]
      }
    },
    {
      name: "read_file",
      description: "读取文件内容",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径（相对于项目根目录）" },
          limit: { type: "integer", description: "最大行数" }
        },
        required: ["path"]
      }
    },
    {
      name: "write_file",
      description: "写入文件",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "文件内容" }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "edit_file",
      description: "编辑文件（替换指定文本）",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          old_text: { type: "string", description: "要替换的原文本" },
          new_text: { type: "string", description: "新文本" }
        },
        required: ["path", "old_text", "new_text"]
      }
    },
    {
      name: "search_code",
      description: "在项目中搜索代码",
      input_schema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "搜索关键词" },
          file_pattern: { type: "string", description: "文件模式，如 *.vue" }
        },
        required: ["keyword"]
      }
    }
  ];
}

/**
 * 创建工具处理器
 */
function createToolHandlers(projectPath) {
  const safePath = (p) => {
    const fullPath = path.resolve(projectPath, p);
    if (!fullPath.startsWith(projectPath)) {
      throw new Error(`Path escapes workspace: ${p}`);
    }
    return fullPath;
  };

  return {
    bash: async ({ command }) => {
      const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot"];
      if (dangerous.some(d => command.includes(d))) {
        return "Error: Dangerous command blocked";
      }
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: projectPath,
          timeout: 60000,
          maxBuffer: 1024 * 1024 * 5
        });
        return (stdout + stderr).trim().slice(0, 30000) || "(no output)";
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },

    read_file: async ({ path: filePath, limit }) => {
      try {
        const fullPath = safePath(filePath);
        const text = await fs.readFile(fullPath, "utf-8");
        let lines = text.split("\n");
        if (limit && limit < lines.length) {
          lines = [...lines.slice(0, limit), `... (${lines.length - limit} more)`];
        }
        return lines.join("\n").slice(0, 30000);
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },

    write_file: async ({ path: filePath, content }) => {
      try {
        const fullPath = safePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
        return `Wrote ${content.length} bytes to ${filePath}`;
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },

    edit_file: async ({ path: filePath, old_text, new_text }) => {
      try {
        const fullPath = safePath(filePath);
        const content = await fs.readFile(fullPath, "utf-8");
        if (!content.includes(old_text)) {
          return `Error: Text not found in ${filePath}`;
        }
        const newContent = content.replace(old_text, new_text);
        await fs.writeFile(fullPath, newContent, "utf-8");
        return `Edited ${filePath}`;
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },

    search_code: async ({ keyword, file_pattern }) => {
      try {
        let cmd = `grep -rn "${keyword}" "${projectPath}"`;
        if (file_pattern) {
          cmd += ` --include="${file_pattern}"`;
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
  };
}

/**
 * 运行 Code Agent
 * @param {object} prdResult - PRD 解析结果
 * @param {string} projectPath - 项目路径
 * @returns {Promise<string[]>} - 修改的文件列表
 */
export async function runCodeAgent(prdResult, projectPath) {
  const tools = createTools(projectPath);
  const handlers = createToolHandlers(projectPath);
  const modifiedFiles = new Set();

  const messages = [
    {
      role: "user",
      content: `请根据以下需求修改代码：

## 需求摘要
${prdResult.summary}

## 问题描述
${prdResult.problem}

## 期望行为
${prdResult.expected}

## 可能涉及的范围
${prdResult.scope?.join(", ") || "未知"}

请先搜索相关代码，理解上下文，然后进行必要的修改。完成后列出所有修改的文件。`
    }
  ];

  // Agent 循环
  for (let i = 0; i < 30; i++) {
    const response = await client.messages.create({
      model: anthropicConfig.model,
      system: SYSTEM,
      messages,
      tools,
      max_tokens: 8000
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // 返回修改的文件列表
      return Array.from(modifiedFiles);
    }

    // 执行工具调用
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

        // 记录修改的文件
        if ((block.name === "edit_file" || block.name === "write_file") && !output.startsWith("Error")) {
          modifiedFiles.add(block.input.path);
        }

        console.log(`  [code-agent] ${block.name}: ${String(output).slice(0, 100)}...`);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output)
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return Array.from(modifiedFiles);
}

export default { runCodeAgent };
