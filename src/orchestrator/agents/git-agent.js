/**
 * git-agent.js - Git 操作子 Agent
 * 
 * 负责创建分支、提交代码、推送到远端
 */

import Anthropic from "@anthropic-ai/sdk";
import config from "../../config/index.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const { anthropic: anthropicConfig } = config;

const client = new Anthropic({
  baseURL: anthropicConfig.baseURL,
  apiKey: anthropicConfig.apiKey,
});

const SYSTEM = `你是一个 Git 操作专家。你的任务是：
1. 创建新分支（如果需要）
2. 提交代码变更
3. 推送到远端仓库
4. 返回提交信息和 MR/PR 链接

工作原则：
- 使用有意义的提交信息
- 确保所有变更都被提交
- 推送前检查远端分支状态

提交信息格式：
fix: 简短描述
或
feat: 简短描述`;

/**
 * 创建工具定义
 */
function createTools() {
  return [
    {
      name: "git_status",
      description: "查看 Git 状态",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "git_diff",
      description: "查看代码变更",
      input_schema: {
        type: "object",
        properties: {
          file: { type: "string", description: "指定文件，留空查看所有" }
        }
      }
    },
    {
      name: "git_branch",
      description: "创建或切换分支",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "分支名" },
          create: { type: "boolean", description: "是否创建新分支" }
        },
        required: ["name"]
      }
    },
    {
      name: "git_add",
      description: "添加文件到暂存区",
      input_schema: {
        type: "object",
        properties: {
          files: { type: "string", description: "文件路径，多个用空格分隔，或 . 表示全部" }
        },
        required: ["files"]
      }
    },
    {
      name: "git_commit",
      description: "提交变更",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "提交信息" }
        },
        required: ["message"]
      }
    },
    {
      name: "git_push",
      description: "推送到远端",
      input_schema: {
        type: "object",
        properties: {
          remote: { type: "string", description: "远端名称，默认 origin" },
          branch: { type: "string", description: "分支名" },
          set_upstream: { type: "boolean", description: "是否设置上游分支" }
        },
        required: ["branch"]
      }
    },
    {
      name: "git_log",
      description: "查看提交历史",
      input_schema: {
        type: "object",
        properties: {
          count: { type: "integer", description: "显示条数，默认 5" }
        }
      }
    }
  ];
}

/**
 * 创建工具处理器
 */
function createToolHandlers(projectPath) {
  const runGit = async (cmd) => {
    try {
      const { stdout, stderr } = await execAsync(`git ${cmd}`, {
        cwd: projectPath,
        timeout: 30000
      });
      return (stdout + stderr).trim() || "(no output)";
    } catch (error) {
      return `Error: ${error.message}`;
    }
  };

  return {
    git_status: async () => runGit("status"),
    
    git_diff: async ({ file }) => {
      const cmd = file ? `diff ${file}` : "diff";
      return runGit(cmd);
    },
    
    git_branch: async ({ name, create }) => {
      if (create) {
        return runGit(`checkout -b ${name}`);
      }
      return runGit(`checkout ${name}`);
    },
    
    git_add: async ({ files }) => runGit(`add ${files}`),
    
    git_commit: async ({ message }) => runGit(`commit -m "${message.replace(/"/g, '\\"')}"`),
    
    git_push: async ({ remote = "origin", branch, set_upstream }) => {
      const cmd = set_upstream 
        ? `push -u ${remote} ${branch}`
        : `push ${remote} ${branch}`;
      return runGit(cmd);
    },
    
    git_log: async ({ count = 5 }) => runGit(`log --oneline -n ${count}`)
  };
}

/**
 * 运行 Git Agent
 * @param {string[]} modifiedFiles - 修改的文件列表
 * @param {string} projectPath - 项目路径
 * @param {string} branch - 目标分支名
 * @param {string} taskName - 任务名称（用于生成提交信息）
 * @returns {Promise<{commit: string, branch: string, pushed: boolean}>}
 */
export async function runGitAgent(modifiedFiles, projectPath, branch, taskName) {
  const tools = createTools();
  const handlers = createToolHandlers(projectPath);

  const messages = [
    {
      role: "user",
      content: `请完成以下 Git 操作：

## 修改的文件
${modifiedFiles.join('\n')}

## 任务描述
${taskName}

## 目标分支
${branch || '（请根据任务创建合适的分支名）'}

请执行以下步骤：
1. 查看当前 Git 状态
2. 如果需要，创建新分支
3. 添加修改的文件
4. 提交变更（使用有意义的提交信息）
5. 推送到远端

完成后返回提交 hash 和分支名。`
    }
  ];

  let result = {
    commit: null,
    branch: null,
    pushed: false
  };

  // Agent 循环
  for (let i = 0; i < 15; i++) {
    const response = await client.messages.create({
      model: anthropicConfig.model,
      system: SYSTEM,
      messages,
      tools,
      max_tokens: 4000
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // 解析最终结果
      const textBlocks = response.content.filter(b => b.type === "text");
      const text = textBlocks.map(b => b.text).join("\n");

      // 尝试提取 commit hash
      const commitMatch = text.match(/[a-f0-9]{7,40}/);
      if (commitMatch) {
        result.commit = commitMatch[0];
      }

      // 检查是否推送成功
      result.pushed = text.includes('push') && !text.includes('Error');

      return result;
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

        // 记录分支信息
        if (block.name === "git_branch" && !output.startsWith("Error")) {
          result.branch = block.input.name;
        }

        // 记录提交信息
        if (block.name === "git_commit" && !output.startsWith("Error")) {
          const hashMatch = output.match(/[a-f0-9]{7,40}/);
          if (hashMatch) {
            result.commit = hashMatch[0];
          }
        }

        // 记录推送状态
        if (block.name === "git_push" && !output.startsWith("Error")) {
          result.pushed = true;
        }

        console.log(`  [git-agent] ${block.name}: ${String(output).slice(0, 100)}...`);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output)
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return result;
}

export default { runGitAgent };
