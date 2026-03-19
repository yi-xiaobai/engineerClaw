#!/usr/bin/env node
/**
 * cli.js - 命令行入口
 * 
 * 用法:
 *   node src/cli.js --task ./task.json    # 执行任务
 *   node src/cli.js --status <task_id>    # 查看任务状态
 *   node src/cli.js --list                # 列出所有任务
 *   node src/cli.js                       # 交互式输入
 */

import { runOrchestrator, getTaskStatus, listTasks } from './orchestrator/index.js';
import { readFileSync, existsSync } from 'fs';
import * as readline from 'readline';
import config from './config/index.js';

// 默认配置（只保留飞书通知，其他由 Agent 自动识别）
const DEFAULT_CONFIG = {
  feishuWebhook: config.feishu.webhook,
  notifyUser: config.feishu.notifyUser
};

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { command: 'interactive' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--task' || arg === '-t') {
      result.command = 'task';
      result.taskFile = args[++i];
    } else if (arg === '--status' || arg === '-s') {
      result.command = 'status';
      result.taskId = args[++i];
    } else if (arg === '--list' || arg === '-l') {
      result.command = 'list';
    } else if (arg === '--help' || arg === '-h') {
      result.command = 'help';
    } else if (arg === '--prd' || arg === '-p') {
      result.prd = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      result.name = args[++i];
    }
  }

  return result;
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
🤖 Engineer Claw - 自动化开发助手

用法:
  node src/cli.js [选项]

选项:
  --task, -t <file>     执行任务配置文件
  --status, -s <id>     查看任务状态
  --list, -l            列出所有任务
  --prd, -p <text>      直接指定需求描述
  --name, -n <name>     任务名称
  --help, -h            显示帮助

示例:
  # 使用配置文件
  node src/cli.js --task ./task.json

  # 直接指定需求
  node src/cli.js --prd "修复登录页验证码不刷新的问题" --name "修复验证码"

  # 查看任务状态
  node src/cli.js --status task_xxx

  # 交互式输入
  node src/cli.js

任务配置文件格式 (task.json):
{
  "name": "任务名称",
  "prd": "需求描述或链接",
  "projectPath": "/path/to/project",
  "branch": "fix/xxx"  // 可选，其他配置由 Agent 自动识别
}
`);
}

/**
 * 交互式输入
 */
async function interactiveInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise(resolve => {
    rl.question(prompt, resolve);
  });

  console.log('\n🤖 Engineer Claw - 交互式任务创建\n');

  const config = { ...DEFAULT_CONFIG };

  // 必填项 - 循环直到用户输入有效内容或 exit
  while (true) {
    config.prd = (await question('📝 需求描述 (或 PRD 链接，输入 exit 退出): ')).trim();
    
    if (config.prd.toLowerCase() === 'exit') {
      console.log('👋 再见！');
      rl.close();
      return null;
    }
    
    if (config.prd) {
      break; // 有效输入，继续
    }
    
    console.log('⚠️  需求描述不能为空，请重新输入');
  }

  config.name = await question('📌 任务名称 (可选): ') || '自动化任务';

  // 可选项
  config.projectPath = await question('📁 项目路径: ');
  if (!config.projectPath) {
    console.log('❌ 项目路径不能为空');
    rl.close();
    return null;
  }

  const customBranch = await question('🌿 分支名 (可选，留空自动生成): ');
  if (customBranch) config.branch = customBranch;

  const customWebhook = await question('🔔 飞书 Webhook (可选): ');
  if (customWebhook) config.feishuWebhook = customWebhook;

  rl.close();
  return config;
}

/**
 * 执行任务
 */
async function executeTask(config) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 任务配置:');
  console.log(`   名称: ${config.name}`);
  console.log(`   需求: ${config.prd.slice(0, 50)}${config.prd.length > 50 ? '...' : ''}`);
  console.log(`   项目: ${config.projectPath}`);
  console.log(`   分支: ${config.branch || '(自动生成)'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const result = await runOrchestrator(config);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 执行结果:');
  console.log(`   状态: ${result.status}`);
  console.log(`   任务 ID: ${result.id}`);
  
  if (result.result.modifiedFiles?.length > 0) {
    console.log(`   修改文件: ${result.result.modifiedFiles.join(', ')}`);
  }
  
  if (result.result.gitCommit) {
    console.log(`   提交: ${result.result.gitCommit}`);
  }
  
  if (result.error) {
    console.log(`   错误: ${result.error}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return result;
}

/**
 * 主函数
 */
async function main() {
  const args = parseArgs();

  switch (args.command) {
    case 'help':
      showHelp();
      break;

    case 'list': {
      const tasks = listTasks();
      if (tasks.length === 0) {
        console.log('📭 暂无任务');
      } else {
        console.log('\n📋 任务列表:\n');
        for (const task of tasks) {
          const emoji = {
            completed: '✅',
            failed: '❌',
            pending: '⏳'
          }[task.status] || '🔄';
          console.log(`${emoji} ${task.id} - ${task.name} [${task.status}]`);
          console.log(`   创建: ${task.createdAt}`);
        }
        console.log();
      }
      break;
    }

    case 'status': {
      if (!args.taskId) {
        console.log('❌ 请指定任务 ID: --status <task_id>');
        process.exit(1);
      }
      try {
        const status = getTaskStatus(args.taskId);
        console.log('\n' + status + '\n');
      } catch (error) {
        console.log(`❌ ${error.message}`);
        process.exit(1);
      }
      break;
    }

    case 'task': {
      if (!args.taskFile) {
        console.log('❌ 请指定任务文件: --task <file>');
        process.exit(1);
      }
      if (!existsSync(args.taskFile)) {
        console.log(`❌ 文件不存在: ${args.taskFile}`);
        process.exit(1);
      }
      try {
        const config = JSON.parse(readFileSync(args.taskFile, 'utf-8'));
        const mergedConfig = { ...DEFAULT_CONFIG, ...config };
        await executeTask(mergedConfig);
      } catch (error) {
        console.log(`❌ 解析配置文件失败: ${error.message}`);
        process.exit(1);
      }
      break;
    }

    case 'interactive':
    default: {
      // 如果直接指定了 prd，跳过交互
      if (args.prd) {
        const config = {
          ...DEFAULT_CONFIG,
          prd: args.prd,
          name: args.name || '命令行任务'
        };
        await executeTask(config);
      } else {
        const config = await interactiveInput();
        if (config) {
          await executeTask(config);
        }
      }
      break;
    }
  }
}

// 运行
main().catch(error => {
  console.error('❌ 执行错误:', error.message);
  process.exit(1);
});
