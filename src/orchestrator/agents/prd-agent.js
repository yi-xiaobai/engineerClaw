/**
 * prd-agent.js - PRD 读取子 Agent
 * 
 * 负责读取和解析需求文档，提取关键信息和验证步骤
 */

import Anthropic from "@anthropic-ai/sdk";
import config from "../../config/index.js";
import axios from "axios";

const { anthropic: anthropicConfig } = config;

const client = new Anthropic({
  baseURL: anthropicConfig.baseURL,
  apiKey: anthropicConfig.apiKey,
});

const SYSTEM = `你是一个 PRD 解析专家。你的任务是：
1. 读取和理解需求文档或问题描述
2. 提取关键信息：问题描述、期望行为、影响范围
3. 生成验证步骤：用于 E2E 测试验证问题是否解决

输出格式（JSON）：
{
  "summary": "需求/问题的简要描述",
  "problem": "当前问题或需要实现的功能",
  "expected": "期望的行为或结果",
  "scope": ["受影响的文件或模块"],
  "verifySteps": [
    {
      "description": "验证步骤描述",
      "action": "具体操作（如：点击某按钮）",
      "assertion": "断言条件（如：页面显示xxx）"
    }
  ]
}

如果输入是 URL，先读取内容再解析。
如果输入是纯文本描述，直接解析。`;

const TOOLS = [
  {
    name: "read_url",
    description: "读取 URL 内容（支持飞书文档等）",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要读取的 URL" }
      },
      required: ["url"]
    }
  }
];

/**
 * 读取 URL 内容
 */
async function readUrl(url) {
  try {
    // 飞书文档需要特殊处理
    if (url.includes('feishu.cn') || url.includes('larksuite.com')) {
      return `[飞书文档链接] ${url}\n请用户提供文档内容或截图，或者直接描述需求。`;
    }

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      }
    });

    // 简单提取文本内容
    let content = response.data;
    if (typeof content === 'string') {
      // 移除 HTML 标签
      content = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return content.slice(0, 10000);
    }

    return JSON.stringify(content).slice(0, 10000);
  } catch (error) {
    return `Error reading URL: ${error.message}`;
  }
}

const TOOL_HANDLERS = {
  read_url: ({ url }) => readUrl(url)
};

/**
 * 运行 PRD Agent
 * @param {string} prdInput - PRD 链接或文本描述
 * @returns {Promise<object>} - 解析后的 PRD 结构
 */
export async function runPrdAgent(prdInput) {
  const messages = [
    {
      role: "user",
      content: `请解析以下需求/问题，并输出 JSON 格式的结构化信息：

${prdInput}`
    }
  ];

  // Agent 循环
  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model: anthropicConfig.model,
      system: SYSTEM,
      messages,
      tools: TOOLS,
      max_tokens: 4000
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // 提取最终文本
      const textBlocks = response.content.filter(b => b.type === "text");
      const text = textBlocks.map(b => b.text).join("\n");

      // 尝试解析 JSON
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // 解析失败，返回原始文本
      }

      return {
        summary: text,
        problem: prdInput,
        expected: "",
        scope: [],
        verifySteps: []
      };
    }

    // 执行工具调用
    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const handler = TOOL_HANDLERS[block.name];
        const output = handler ? await handler(block.input) : `Unknown tool: ${block.name}`;
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output)
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  throw new Error("PRD Agent reached iteration limit");
}

export default { runPrdAgent };
