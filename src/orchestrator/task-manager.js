/**
 * task-manager.js - 任务状态管理
 * 
 * 任务持久化到 .tasks/ 目录，支持进度追踪和状态查询
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 任务目录
const TASKS_DIR = join(__dirname, '../../.tasks');

// 任务状态枚举
export const TaskStatus = {
  PENDING: 'pending',
  PRD_PARSING: 'prd_parsing',
  CODING: 'coding',
  E2E_TESTING: 'e2e_testing',
  GIT_PUSHING: 'git_pushing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * 任务管理器
 */
class TaskManager {
  constructor() {
    this.dir = TASKS_DIR;
    this._ensureDir();
  }

  _ensureDir() {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    // 创建截图目录
    const screenshotsDir = join(this.dir, 'screenshots');
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }
  }

  /**
   * 生成任务 ID
   */
  _generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    return `task_${timestamp}_${random}`;
  }

  /**
   * 获取任务文件路径
   */
  _getTaskPath(taskId) {
    return join(this.dir, `${taskId}.json`);
  }

  /**
   * 创建新任务
   * @param {object} taskConfig - 任务配置
   * @returns {object} - 任务对象
   */
  create(taskConfig) {
    const taskId = this._generateId();
    const now = new Date().toISOString();

    const task = {
      id: taskId,
      name: taskConfig.name || '未命名任务',
      prd: taskConfig.prd || '',
      projectPath: taskConfig.projectPath || config.task.projectPath,
      startCmd: taskConfig.startCmd || config.task.startCmd,
      devUrl: taskConfig.devUrl || config.task.devUrl,
      gitRemote: taskConfig.gitRemote || config.task.gitRemote,
      branch: taskConfig.branch || '',
      feishuWebhook: taskConfig.feishuWebhook || config.task.feishuWebhook,
      notifyUser: taskConfig.notifyUser || config.task.notifyUser,
      
      // 状态信息
      status: TaskStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      
      // 进度记录
      progress: [],
      
      // 结果
      result: {
        prdSummary: null,
        modifiedFiles: [],
        e2eResult: null,
        screenshots: [],
        gitCommit: null,
        mrUrl: null
      },
      
      // 错误信息
      error: null,
      retryCount: 0
    };

    this._save(task);
    return task;
  }

  /**
   * 保存任务
   */
  _save(task) {
    task.updatedAt = new Date().toISOString();
    const path = this._getTaskPath(task.id);
    writeFileSync(path, JSON.stringify(task, null, 2));
  }

  /**
   * 加载任务
   */
  load(taskId) {
    const path = this._getTaskPath(taskId);
    if (!existsSync(path)) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  /**
   * 更新任务状态
   */
  updateStatus(taskId, status, message = '') {
    const task = this.load(taskId);
    task.status = status;
    task.progress.push({
      step: status,
      time: new Date().toISOString(),
      message
    });
    this._save(task);
    return task;
  }

  /**
   * 更新任务结果
   */
  updateResult(taskId, resultKey, value) {
    const task = this.load(taskId);
    task.result[resultKey] = value;
    this._save(task);
    return task;
  }

  /**
   * 设置任务失败
   */
  setFailed(taskId, error) {
    const task = this.load(taskId);
    task.status = TaskStatus.FAILED;
    task.error = error;
    task.progress.push({
      step: 'failed',
      time: new Date().toISOString(),
      message: error
    });
    this._save(task);
    return task;
  }

  /**
   * 增加重试次数
   */
  incrementRetry(taskId) {
    const task = this.load(taskId);
    task.retryCount++;
    this._save(task);
    return task;
  }

  /**
   * 列出所有任务
   */
  listAll() {
    const files = readdirSync(this.dir).filter(f => f.startsWith('task_') && f.endsWith('.json'));
    
    if (files.length === 0) {
      return [];
    }

    return files.map(f => {
      const task = JSON.parse(readFileSync(join(this.dir, f), 'utf-8'));
      return {
        id: task.id,
        name: task.name,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * 获取任务状态摘要
   */
  getStatusSummary(taskId) {
    const task = this.load(taskId);
    const statusEmoji = {
      [TaskStatus.PENDING]: '⏳',
      [TaskStatus.PRD_PARSING]: '📖',
      [TaskStatus.CODING]: '💻',
      [TaskStatus.E2E_TESTING]: '🧪',
      [TaskStatus.GIT_PUSHING]: '📤',
      [TaskStatus.COMPLETED]: '✅',
      [TaskStatus.FAILED]: '❌'
    };

    const lines = [
      `${statusEmoji[task.status] || '❓'} ${task.name}`,
      `ID: ${task.id}`,
      `状态: ${task.status}`,
      `创建: ${task.createdAt}`,
      `更新: ${task.updatedAt}`,
      '',
      '进度:'
    ];

    for (const p of task.progress) {
      lines.push(`  - [${p.time}] ${p.step}: ${p.message || ''}`);
    }

    if (task.error) {
      lines.push('', `错误: ${task.error}`);
    }

    if (task.result.mrUrl) {
      lines.push('', `MR: ${task.result.mrUrl}`);
    }

    return lines.join('\n');
  }

  /**
   * 获取截图目录
   */
  getScreenshotsDir() {
    return join(this.dir, 'screenshots');
  }
}

// 导出单例
export const taskManager = new TaskManager();
export default taskManager;
