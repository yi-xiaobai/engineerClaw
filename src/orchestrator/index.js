/**
 * orchestrator/index.js - 主协调器
 * 
 * 协调多个子 Agent 完成自动化开发流程：
 * PRD 解析 → 代码修改 → E2E 验证 → Git 提交 → 飞书通知
 */

import { taskManager, TaskStatus } from './task-manager.js';
import { runPrdAgent } from './agents/prd-agent.js';
import { runCodeAgent } from './agents/code-agent.js';
import { runE2eAgent } from './agents/e2e-agent.js';
import { runGitAgent } from './agents/git-agent.js';
import config from '../config/index.js';

// 从配置获取最大重试次数
const MAX_RETRIES = config.retry.maxRetries;

/**
 * 发送飞书通知（简化版，后续扩展）
 */
async function sendFeishuNotify(webhook, message, notifyUser = '') {
  if (!webhook) {
    console.log('[notify] No webhook configured, skipping');
    return;
  }

  try {
    const content = notifyUser 
      ? `${message}\n\n@${notifyUser} 请查收`
      : message;

    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: content }
      })
    });

    if (!response.ok) {
      console.error('[notify] Failed to send:', response.statusText);
    }
  } catch (error) {
    console.error('[notify] Error:', error.message);
  }
}

/**
 * 构建结果通知消息
 */
function buildResultMessage(task) {
  const emoji = task.status === TaskStatus.COMPLETED ? '✅' : '❌';
  const lines = [
    `${emoji} 任务${task.status === TaskStatus.COMPLETED ? '完成' : '失败'}: ${task.name}`,
    '━━━━━━━━━━━━━━━━━━━━'
  ];

  if (task.result.prdSummary) {
    lines.push(`📝 需求: ${task.result.prdSummary.summary || task.result.prdSummary}`);
  }

  if (task.result.modifiedFiles?.length > 0) {
    lines.push(`📁 修改文件: ${task.result.modifiedFiles.join(', ')}`);
  }

  if (task.result.e2eResult) {
    const e2eEmoji = task.result.e2eResult.passed ? '✅' : '❌';
    lines.push(`${e2eEmoji} 验证结果: ${task.result.e2eResult.passed ? '通过' : '失败'}`);
  }

  if (task.result.gitCommit) {
    lines.push(`📦 提交: ${task.result.gitCommit}`);
  }

  if (task.result.mrUrl) {
    lines.push(`🔗 MR: ${task.result.mrUrl}`);
  }

  if (task.error) {
    lines.push(`\n❌ 错误: ${task.error}`);
  }

  return lines.join('\n');
}

/**
 * 运行完整的自动化流程
 * @param {object} taskConfig - 任务配置
 * @returns {Promise<object>} - 任务结果
 */
export async function runOrchestrator(taskConfig) {
  // 创建任务
  const task = taskManager.create(taskConfig);
  console.log(`\n🚀 开始任务: ${task.name} (${task.id})`);

  try {
    // ========== 阶段 1: PRD 解析 ==========
    console.log('\n📖 阶段 1: 解析需求...');
    taskManager.updateStatus(task.id, TaskStatus.PRD_PARSING, '正在解析需求文档');

    const prdResult = await runPrdAgent(task.prd);
    taskManager.updateResult(task.id, 'prdSummary', prdResult);
    console.log(`  ✓ 需求摘要: ${prdResult.summary}`);

    // ========== 阶段 2: 代码修改 ==========
    console.log('\n💻 阶段 2: 修改代码...');
    taskManager.updateStatus(task.id, TaskStatus.CODING, '正在修改代码');

    const modifiedFiles = await runCodeAgent(prdResult, task.projectPath);
    taskManager.updateResult(task.id, 'modifiedFiles', modifiedFiles);
    console.log(`  ✓ 修改了 ${modifiedFiles.length} 个文件`);

    if (modifiedFiles.length === 0) {
      throw new Error('没有修改任何文件，请检查需求描述');
    }

    // ========== 阶段 3: E2E 验证 ==========
    console.log('\n🧪 阶段 3: E2E 验证...');
    taskManager.updateStatus(task.id, TaskStatus.E2E_TESTING, '正在启动项目并验证');

    // startCmd 和 devUrl 由 E2E Agent 自动从项目中识别
    let e2eResult = await runE2eAgent(
      prdResult,
      task.projectPath,
      task.id
    );
    taskManager.updateResult(task.id, 'e2eResult', e2eResult);

    // 重试机制
    let retryCount = 0;
    while (!e2eResult.passed && retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`  ⚠️ 验证失败，重试 ${retryCount}/${MAX_RETRIES}...`);
      taskManager.incrementRetry(task.id);

      // 重新修改代码
      console.log('  💻 重新修改代码...');
      const newModifiedFiles = await runCodeAgent(
        { ...prdResult, problem: `${prdResult.problem}\n\n上次验证失败原因: ${e2eResult.message}` },
        task.projectPath
      );
      
      if (newModifiedFiles.length > 0) {
        taskManager.updateResult(task.id, 'modifiedFiles', [
          ...modifiedFiles,
          ...newModifiedFiles.filter(f => !modifiedFiles.includes(f))
        ]);
      }

      // 重新验证
      console.log('  🧪 重新验证...');
      e2eResult = await runE2eAgent(
        prdResult,
        task.projectPath,
        task.id
      );
      taskManager.updateResult(task.id, 'e2eResult', e2eResult);
    }

    if (!e2eResult.passed) {
      throw new Error(`E2E 验证失败（重试 ${retryCount} 次）: ${e2eResult.message}`);
    }

    console.log(`  ✓ 验证通过`);

    // ========== 阶段 4: Git 提交 ==========
    console.log('\n📤 阶段 4: 提交代码...');
    taskManager.updateStatus(task.id, TaskStatus.GIT_PUSHING, '正在提交并推送代码');

    const allModifiedFiles = taskManager.load(task.id).result.modifiedFiles;
    const gitResult = await runGitAgent(
      allModifiedFiles,
      task.projectPath,
      task.branch,
      task.name
    );

    taskManager.updateResult(task.id, 'gitCommit', gitResult.commit);
    if (gitResult.branch) {
      taskManager.updateResult(task.id, 'branch', gitResult.branch);
    }

    console.log(`  ✓ 已提交: ${gitResult.commit}`);
    if (gitResult.pushed) {
      console.log(`  ✓ 已推送到远端`);
    }

    // ========== 完成 ==========
    taskManager.updateStatus(task.id, TaskStatus.COMPLETED, '任务完成');
    console.log(`\n✅ 任务完成: ${task.id}`);

    // 发送飞书通知
    const finalTask = taskManager.load(task.id);
    const message = buildResultMessage(finalTask);
    await sendFeishuNotify(task.feishuWebhook, message, task.notifyUser);

    return finalTask;

  } catch (error) {
    console.error(`\n❌ 任务失败: ${error.message}`);
    taskManager.setFailed(task.id, error.message);

    // 发送失败通知
    const failedTask = taskManager.load(task.id);
    const message = buildResultMessage(failedTask);
    await sendFeishuNotify(task.feishuWebhook, message, task.notifyUser);

    return failedTask;
  }
}

/**
 * 查看任务状态
 */
export function getTaskStatus(taskId) {
  return taskManager.getStatusSummary(taskId);
}

/**
 * 列出所有任务
 */
export function listTasks() {
  return taskManager.listAll();
}

export default {
  runOrchestrator,
  getTaskStatus,
  listTasks
};
