/**
 * config/index.js - 配置管理
 * 
 * 从 ~/engineer-claw.json 加载配置
 */

import { existsSync, readFileSync } from "fs";
import os from "os";

const globalConfigPath = os.homedir() + "/engineer-claw.json";
let globalConfig = {};

if (existsSync(globalConfigPath)) {
  try {
    const content = readFileSync(globalConfigPath, "utf-8");
    globalConfig = JSON.parse(content);
  } catch (e) {
    console.error("加载配置文件失败:", e.message);
  }
}

function getConfig(key, defaultValue) {
  return globalConfig[key] || defaultValue;
}

export default {
  // Anthropic 配置
  anthropic: {
    baseURL: getConfig("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
    apiKey: getConfig("ANTHROPIC_API_KEY"),
    model: getConfig("MODEL_ID", "claude-sonnet-4-20250514"),
  },

  // 任务默认配置
  task: {
    projectPath: getConfig("PROJECT_PATH", ""),
    startCmd: getConfig("START_CMD", "pnpm run serve"),
    devUrl: getConfig("DEV_URL", "http://localhost:8080"),
    gitRemote: getConfig("GIT_REMOTE", "origin"),
    feishuWebhook: getConfig("FEISHU_WEBHOOK", ""),
    notifyUser: getConfig("NOTIFY_USER", ""),
  },

  // 重试配置
  retry: {
    maxRetries: getConfig("MAX_RETRIES", 3),
  },
};
