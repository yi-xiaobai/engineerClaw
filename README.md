# Engineer Claw 🦀

自动化开发助手 - 通过 AI Agent 协调完成开发任务。

## 核心功能

- **PRD 解析** - 读取需求文档，提取关键信息和验证步骤
- **代码修改** - 根据需求自动修改代码
- **E2E 验证** - 启动项目，使用 Playwright 自动化验证
- **Git 提交** - 自动创建分支、提交、推送
- **飞书通知** - 任务完成后发送 Webhook 通知

## 快速开始

### 1. 安装

```bash
yarn install
npx playwright install chromium
```

### 2. 配置

创建 `~/engineer-claw.json`：

```json
{
  "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
  "ANTHROPIC_API_KEY": "your-api-key",
  "MODEL_ID": "claude-sonnet-4-20250514",
  
  "PROJECT_PATH": "/path/to/your/project",
  "START_CMD": "pnpm run serve",
  "DEV_URL": "http://localhost:8080",
  "GIT_REMOTE": "origin",
  "FEISHU_WEBHOOK": "",
  "NOTIFY_USER": "",
  "MAX_RETRIES": 3
}
```

**配置说明：**
- `ANTHROPIC_*` - Claude API 配置（必填）
- `PROJECT_PATH` - 默认项目路径
- `START_CMD` - 项目启动命令
- `DEV_URL` - 开发服务器地址
- `FEISHU_WEBHOOK` - 飞书通知 Webhook
- `MAX_RETRIES` - E2E 验证失败重试次数

### 3. 使用

```bash
# 交互式创建任务
node src/cli.js

# 使用配置文件
node src/cli.js --task ./task-example.json

# 直接指定需求
node src/cli.js --prd "修复登录页验证码不刷新的问题" --name "修复验证码"

# 查看任务状态
node src/cli.js --status task_xxx

# 列出所有任务
node src/cli.js --list
```

## 任务配置

```json
{
  "name": "修复登录页 Bug",
  "prd": "登录页验证码点击后不刷新",
  "projectPath": "/path/to/project",
  "startCmd": "pnpm run serve",
  "devUrl": "http://localhost:8080",
  "branch": "fix/captcha-refresh",
  "feishuWebhook": "https://open.feishu.cn/xxx",
  "notifyUser": "luoyi"
}
```

## 执行流程

```
PRD 解析 → 代码修改 → E2E 验证 → (失败重试 x3) → Git 提交 → 飞书通知
```

## 项目结构

```
engineer-claw/
├── src/
│   ├── cli.js                # 命令行入口
│   ├── config/index.js       # 配置管理
│   ├── lib/tools.js          # 通用工具函数
│   └── orchestrator/         # 自动化协调器
│       ├── index.js          # 主协调器
│       ├── task-manager.js   # 任务状态管理
│       └── agents/           # 子 Agent
│           ├── prd-agent.js  # PRD 解析
│           ├── code-agent.js # 代码修改
│           ├── e2e-agent.js  # E2E 验证
│           └── git-agent.js  # Git 操作
├── .tasks/                   # 任务状态持久化
├── task-example.json         # 示例配置
└── package.json
```

## 依赖

- `@anthropic-ai/sdk` - Claude API
- `playwright` - E2E 自动化测试
- `axios` - HTTP 请求
