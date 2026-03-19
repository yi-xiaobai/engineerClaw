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

const SYSTEM = `你是一个 E2E 测试专家，使用 Playwright 进行自动化测试。你的任务是：
1. 根据验证步骤生成 Playwright 测试脚本
2. 执行测试并截图
3. 验证问题是否已解决

Playwright 脚本模板：
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
function createToolHandlers(projectPath, taskId, devUrl) {
  const screenshotsDir = taskManager.getScreenshotsDir();

  return {
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
 * @param {string} startCmd - 启动命令
 * @param {string} devUrl - 开发服务器 URL
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{passed: boolean, message: string}>}
 */
export async function runE2eAgent(prdResult, projectPath, startCmd, devUrl, taskId) {
  let devServer = null;

  try {
    // 启动开发服务器
    console.log(`  [e2e-agent] Starting dev server: ${startCmd}`);
    devServer = await startDevServer(projectPath, startCmd);

    // 等待服务就绪
    console.log(`  [e2e-agent] Waiting for server at ${devUrl}...`);
    await waitForServer(devUrl);
    console.log(`  [e2e-agent] Server ready`);

    const tools = createTools(projectPath, taskId);
    const handlers = createToolHandlers(projectPath, taskId, devUrl);

    const verifyStepsText = prdResult.verifySteps?.map((step, i) => 
      `${i + 1}. ${step.description}\n   操作: ${step.action}\n   断言: ${step.assertion}`
    ).join('\n') || '无具体验证步骤，请根据需求描述自行设计验证方案';

    const messages = [
      {
        role: "user",
        content: `请验证以下问题是否已解决：

## 问题描述
${prdResult.problem}

## 期望行为
${prdResult.expected}

## 验证步骤
${verifyStepsText}

## 开发服务器
URL: ${devUrl}

请生成并执行 Playwright 测试脚本来验证问题是否已解决。记得截图。`
      }
    ];

    // Agent 循环
    for (let i = 0; i < 10; i++) {
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

  } finally {
    // 停止开发服务器
    if (devServer) {
      console.log(`  [e2e-agent] Stopping dev server`);
      stopDevServer(devServer);
    }
  }
}

export default { runE2eAgent };
