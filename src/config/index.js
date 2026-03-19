/**
 * config/index.js - 配置管理
 * 
 * 只保留必要的全局配置（API Key 等）
 * startCmd / devUrl / gitRemote 等项目相关配置由 Agent 运行时自己识别
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
  // Anthropic 配置（必须手动配置）
  anthropic: {
    baseURL: getConfig("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
    apiKey: getConfig("ANTHROPIC_API_KEY"),
    model: getConfig("MODEL_ID", "claude-sonnet-4-20250514"),
  },

  // 飞书配置（可选）
  feishu: {
    webhook: getConfig("FEISHU_WEBHOOK", ""),
    notifyUser: getConfig("NOTIFY_USER", ""),
  },

  // Git 配置（可选，Agent 也能自己识别）
  git: {
    gitlabToken: getConfig("GITLAB_TOKEN", ""),
    gitlabHost: getConfig("GITLAB_HOST", ""),
    githubToken: getConfig("GITHUB_TOKEN", ""),
  },

  // 重试配置
  retry: {
    maxRetries: getConfig("MAX_RETRIES", 3),
  },
};
