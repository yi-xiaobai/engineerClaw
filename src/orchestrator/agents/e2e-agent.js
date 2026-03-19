/**
 * e2e-agent.js - E2E 验证子 Agent
 * 
 * 负责启动项目并使用 Playwright 进行自动化验证
 */

import Anthropic from "@anthropic-ai/sdk";
import config from "../../config/index.js";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { taskManager } from "../task-manager.js";

const execAsync = promisify(exec);
const { anthropic: anthropicConfig } = config;

const client = new Anthropic({
  baseURL: anthropicConfig.baseURL,
  apiKey: anthropicConfig.apiKey,
});

const SYSTEM = `你是一个 E2E 测试专家，使用 Playwright 进行自动化测试。

## 你的能力
1. 读取项目的 package.json 来识别启动命令（dev/serve/start）和包管理器
2. 读取项目配置文件（vite.config/vue.config/.env）来识别开发服务器 URL
3. 根据验证步骤生成 Playwright 测试脚本
4. 执行测试并截图
5. 验证问题是否已解决

## 常见的本地域名
- local.mastergo.com
- localhost
- 127.0.0.1

## Playwright 脚本模板
\`\`\`javascript
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto('http://localhost:8080');
  // 执行操作...
  await page.screenshot({ path: 'screenshot.png' });
  console.log('TEST_PASSED');
} catch (error) {
  console.log('TEST_FAILED:', error.message);
} finally {
  await browser.close();
}
\`\`\`

输出 TEST_PASSED 或 TEST_FAILED 表示测试结果。`;

/**
 * 等待服务就绪
 */
async function waitForServer(url, timeout = 60000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 304) {
        return true;
      }
    } catch (e) {
      // 服务未就绪，继续等待
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  throw new Error(`Server not ready after ${timeout}ms`);
}

/**
 * 启动开发服务器
 */
function startDevServer(projectPath, startCmd) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = startCmd.split(' ');
    
    const proc = spawn(cmd, args, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      shell: true
    });

    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      // 检测服务启动成功的标志
      if (output.includes('Local:') || output.includes('ready') || output.includes('compiled')) {
        resolve(proc);
      }
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    // 超时处理
    setTimeout(() => {
      resolve(proc); // 即使没有检测到标志，也继续
    }, 30000);
  });
}

/**
 * 停止开发服务器
 */
function stopDevServer(proc) {
  if (proc && proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch (e) {
      // 进程可能已经结束
    }
  }
}

/**
 * 创建工具定义
 */
function createTools(projectPath, taskId) {
  return [
    {
      name: "read_file",
      description: "读取项目文件，用于识别项目配置（package.json, vite.config.js 等）",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于项目根目录的文件路径" }
        },
        required: ["path"]
      }
    },
    {
      name: "bash",
      description: "执行 shell 命令，用于启动项目或检查状态",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" }
        },
        required: ["command"]
      }
    },
    {
      name: "run_playwright_test",
      description: "执行 Playwright 测试脚本",
      input_schema: {
        type: "object",
        properties: {
          script: { type: "string", description: "Playwright 测试脚本内容" },
          screenshot_name: { type: "string", description: "截图文件名" }
        },
        required: ["script"]
      }
    },
    {
      name: "check_page",
      description: "检查页面元素是否存在",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "页面 URL" },
          selector: { type: "string", description: "CSS 选择器" }
        },
        required: ["url", "selector"]
      }
    }
  ];
}

/**
 * 创建工具处理器
 */
function createToolHandlers(projectPath, taskId) {
  const screenshotsDir = taskManager.getScreenshotsDir();

  return {
    read_file: async ({ path: filePath }) => {
      try {
        const fullPath = path.join(projectPath, filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return content.slice(0, 10000);
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },

    bash: async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: projectPath,
          timeout: 30000
        });
        return (stdout + stderr).slice(0, 5000) || '(no output)';
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },

    run_playwright_test: async ({ script, screenshot_name }) => {
      try {
        // 创建临时测试文件
        const testFile = path.join(projectPath, `.e2e-test-${Date.now()}.mjs`);
        const screenshotPath = path.join(screenshotsDir, screenshot_name || `${taskId}-${Date.now()}.png`);
        
        // 替换截图路径
        const finalScript = script.replace(/screenshot\.png/g, screenshotPath);
        
        await fs.writeFile(testFile, finalScript, 'utf-8');

        try {
          const { stdout, stderr } = await execAsync(`node ${testFile}`, {
            cwd: projectPath,
            timeout: 60000,
            env: { ...process.env, NODE_OPTIONS: '' }
          });

          const output = stdout + stderr;
          
          // 清理临时文件
          await fs.unlink(testFile).catch(() => {});

          if (output.includes('TEST_PASSED')) {
            // 记录截图
            taskManager.updateResult(taskId, 'screenshots', [
              ...(taskManager.load(taskId).result.screenshots || []),
              screenshotPath
            ]);
            return `TEST_PASSED\nScreenshot: ${screenshotPath}`;
          } else if (output.includes('TEST_FAILED')) {
            return `TEST_FAILED\n${output}`;
          }
          
          return output.slice(0, 5000);
        } catch (error) {
          await fs.unlink(testFile).catch(() => {});
          return `Error running test: ${error.message}`;
        }
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },

    check_page: async ({ url, selector }) => {
      const script = `
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto('${url}', { waitUntil: 'networkidle' });
  const element = await page.locator('${selector}');
  const count = await element.count();
  if (count > 0) {
    console.log('ELEMENT_FOUND:', count);
  } else {
    console.log('ELEMENT_NOT_FOUND');
  }
} catch (error) {
  console.log('ERROR:', error.message);
} finally {
  await browser.close();
}
`;
      const testFile = path.join(projectPath, `.check-page-${Date.now()}.mjs`);
      await fs.writeFile(testFile, script, 'utf-8');

      try {
        const { stdout } = await execAsync(`node ${testFile}`, {
          cwd: projectPath,
          timeout: 30000
        });
        await fs.unlink(testFile).catch(() => {});
        return stdout.trim();
      } catch (error) {
        await fs.unlink(testFile).catch(() => {});
        return `Error: ${error.message}`;
      }
    }
  };
}

/**
 * 运行 E2E Agent
 * @param {object} prdResult - PRD 解析结果（包含验证步骤）
 * @param {string} projectPath - 项目路径
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{passed: boolean, message: string}>}
 */
export async function runE2eAgent(prdResult, projectPath, taskId) {
  let devServer = null;
  let devUrl = null;

  const tools = createTools(projectPath, taskId);
  const handlers = createToolHandlers(projectPath, taskId);

  const verifyStepsText = prdResult.verifySteps?.map((step, i) => 
    `${i + 1}. ${step.description}\n   操作: ${step.action}\n   断言: ${step.assertion}`
  ).join('\n') || '无具体验证步骤，请根据需求描述自行设计验证方案';

  const messages = [
    {
      role: "user",
      content: `请验证以下问题是否已解决：

## 项目路径
${projectPath}

## 问题描述
${prdResult.problem}

## 期望行为
${prdResult.expected}

## 验证步骤
${verifyStepsText}

## 你需要做的
1. 先读取 package.json 识别启动命令和包管理器
2. 读取配置文件（如 vite.config.js）识别开发服务器 URL
3. 启动项目并等待服务就绪
4. 生成并执行 Playwright 测试脚本
5. 截图并返回结果`
    }
  ];

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

      const passed = text.includes('TEST_PASSED') || text.includes('通过') || text.includes('成功');
      
      return {
        passed,
        message: text
      };
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

        console.log(`  [e2e-agent] ${block.name}: ${String(output).slice(0, 100)}...`);

        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output)
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return {
    passed: false,
    message: "E2E Agent reached iteration limit"
  };
}

export default { runE2eAgent };
