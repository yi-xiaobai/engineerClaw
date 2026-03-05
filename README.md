# 飞书 Agent 服务

通过飞书机器人与 Claude/MiniMax Agent 交互，支持 WebSocket 长连接模式。

## 功能特性

- 🤖 基于飞书 WebSocket 长连接模式，无需公网回调
- 💬 支持群聊和私聊
- 🧠 集成 Claude/MiniMax AI 能力
- 💾 会话历史管理，支持多用户独立对话
- 🔧 支持执行 Shell 命令、文件操作等工具

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```
# 飞书应用配置
APP_ID=你的飞书应用AppID
APP_SECRET=你的飞书应用AppSecret
VERIFICATION_TOKEN=你的验证Token
ENCRYPT_KEY=你的加密Key

# Anthropic/MiniMax API 配置
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_API_KEY=你的APIKey
MODEL_ID=MiniMax-M2.5-highspeed
```

### 3. 启动服务

```bash
# 开发模式（代码改动自动重启）
npm run dev

# 生产模式
npm start
```

## 飞书开放平台配置

### 1. 创建应用
在 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用，获取 App ID 和 App Secret。

### 2. 配置权限
在「权限管理」中添加：
- `im:message:send_as_bot` - 发送消息
- `im:message:receive_v1` - 接收消息

### 3. 配置事件订阅

1. 进入「事件与回调」
2. **订阅方式**选择「使用长连接接收事件/回调」
3. 添加事件：
   - `im.message.receive_v1` - 接收消息
   - `im.chat.member.bot.created_v1` - 机器人入群
   - `im.chat.member.bot.deleted_v1` - 机器人离群

### 4. 发布应用
创建版本并提交审核发布。

## 使用方式

1. 将机器人添加到群聊或好友
2. @机器人 发送消息
3. 机器人会自动回复

### 命令

- `/help` - 显示帮助
- `/clear` - 清空对话历史

## 项目结构

```
feishu-agent/
├── src/
│   ├── index.js          # 入口文件
│   ├── config/           # 配置
│   ├── handlers/         # 事件处理器
│   │   └── message.js   # 消息处理
│   ├── services/         # 服务层
│   │   ├── agent.js     # AI Agent
│   │   └── feishu.js    # 飞书 SDK
│   └── tools/            # 工具定义
├── .env                  # 环境变量
└── package.json
```
