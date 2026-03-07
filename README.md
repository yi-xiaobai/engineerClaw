# 飞书 Agent 服务

通过飞书机器人与 Claude/MiniMax Agent 交互，支持 WebSocket 长连接模式。

## 功能特性

- 🤖 基于飞书 WebSocket 长连接模式，无需公网回调
- 💬 支持群聊和私聊
- 🧠 集成 Claude/MiniMax AI 能力
- 💾 会话历史管理，支持多用户独立对话
- 🔧 支持执行 Shell 命令、文件操作等工具
- 📁 多项目管理 - 智能搜索和切换项目
- 🔍 代码搜索 - 单项目或跨项目搜索代码
- 🌿 Git 集成 - 完整的 Git 工作流支持
- 🔀 GitLab MCP - 创建 MR、推送代码
- 💻 IDE 集成 - 在 Windsurf/Cursor 中打开项目
- 📚 Skills 系统 - 按需加载专业知识,节省 tokens

## 快速开始

### 1. 安装依赖

```bash
yarn install
```

### 2. 配置

在用户主目录创建 `~/feishu-agent.json` 配置文件：

```bash
vim ~/feishu-agent.json
```

添加以下内容：

```json
{
  "APP_ID": "你的飞书应用AppID",
  "APP_SECRET": "你的飞书应用AppSecret",
  "VERIFICATION_TOKEN": "你的验证Token",
  "ENCRYPT_KEY": "你的加密Key",
  "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
  "ANTHROPIC_API_KEY": "你的APIKey",
  "MODEL_ID": "MiniMax-M2.5-highspeed",
  "GITLAB_DEFAULT_TARGET": "dev",
  "IDE_TOOL": "windsurf",
  "PROJECTS_BASE_PATH": "/path/to/your/projects"
}
```
```

### 3. 启动服务

```bash
# 开发模式（代码改动自动重启）
yarn dev

# 生产模式
yarn start
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

### 使用示例

**场景 1: 单项目完整工作流**
```
帮我打开 master-web 项目，搜索 /entity-banner 接口，
删除所有调用的地方，然后推送到远端，
创建基于 dev 分支的 MR，最后把版本号发给我
```

Agent 会自动执行:
1. 切换到 master-web 项目
2. 搜索 `/entity-banner` 关键词
3. 读取并编辑相关文件
4. Git 提交并推送
5. 创建 GitLab MR
6. 返回版本号和 MR 链接

**场景 2: 多项目搜索**
```
帮我在所有项目中搜索 useEntityBanner 这个 hook，
看看哪些项目在用
```

Agent 会:
1. 扫描所有项目
2. 跨项目搜索关键词
3. 返回每个项目中的匹配位置

**场景 3: 项目管理**
```
列出所有可用的项目
```

```
切换到 lanhu-order 项目，查看 Git 状态
```

### 可用工具

#### 项目管理
- `find_projects` - 扫描所有项目
- `open_project` - 切换项目
- `search_code` - 在当前项目搜索
- `search_all_projects` - 跨项目搜索

#### IDE 集成
- `open_in_ide` - 在 IDE 中打开

#### 文件操作
- `read_file` - 读取文件
- `write_file` - 写入文件
- `edit_file` - 编辑文件
- `find_file` - 查找文件

#### Skills 系统
- `load_skill` - 加载专业知识

#### GitHub 工具
- `create_pull_request` - 创建 PR
- `list_pull_requests` - 列出 PR
- `get_pull_request` - 查看 PR 详情

#### 其他
- `bash` - 执行命令

## Skills 系统

Skills 系统采用两层加载机制,节省系统提示词 tokens:

### Layer 1: 元数据(系统提示词)
只在系统提示词中包含技能名称和简短描述(~100 tokens/技能)

### Layer 2: 完整内容(按需加载)
调用 `load_skill` 时返回完整的专业知识和工作流指导

### 可用技能

1. **git-workflow** - Git 完整工作流
   - 代码提交标准流程
   - 分支管理规范
   - Commit Message 规范
   - 错误处理和最佳实践

2. **project-management** - 多项目管理
   - 项目扫描和切换
   - 代码搜索策略
   - 跨项目操作流程

3. **code-search** - 代码搜索最佳实践
   - 搜索策略和技巧
   - 关键词选择
   - 结果分析
   - 高级搜索模式

### 使用方式

Agent 会在需要时自动加载相关技能,例如:

```
用户: 帮我提交代码到 Git
Agent: (自动调用 load_skill("git-workflow"))
      (获取完整的 Git 工作流指导)
      (按照标准流程执行)
```

### 优势

- **节省 tokens**: 系统提示词更简洁
- **按需加载**: 只在需要时加载完整内容
- **易于维护**: Skills 可独立更新
- **知识复用**: 同一技能可用于多个场景

## 项目结构

```
feishu-agent/
├── src/
│   ├── index.js          # 入口文件
│   ├── config/           # 配置
│   │   └── index.js     # 配置管理
│   ├── handlers/         # 事件处理器
│   │   └── message.js   # 消息处理
│   ├── services/         # 服务层
│   │   ├── agent.js     # AI Agent
│   │   ├── feishu.js    # 飞书 SDK
│   │   └── mcp-client.js # MCP 客户端
│   ├── tools/            # 工具定义
│   │   ├── definitions.js  # 工具定义
│   │   ├── handlers.js     # 工具处理器
│   │   └── index.js        # 工具实现
│   └── utils/            # 工具函数
│       ├── project.js   # 项目搜索
│       └── skills.js    # Skills 加载器
├── skills/               # 专业技能知识库
│   ├── git-workflow/
│   │   └── SKILL.md
│   ├── project-management/
│   │   └── SKILL.md
│   └── code-search/
│       └── SKILL.md
└── package.json
```

## 配置说明

### MCP 配置

本项目支持通过 MCP 协议连接外部服务（如 GitHub、GitLab）。在 `~/feishu-agent.json` 中配置：

```json
{
  "GITHUB_TOKEN": "ghp_your_token"
}
```

启动时会自动连接配置的 MCP 服务器，获取其提供的所有工具。

### 项目路径配置

在 `~/feishu-agent.json` 中配置项目基础路径:
```json
{
  "PROJECTS_BASE_PATH": "/path/to/your/projects"
}
```

Agent 会自动扫描该目录下的所有项目(支持 3 层深度)。

## 注意事项

1. **项目缓存**: 项目列表会缓存 1 小时,如需强制刷新使用 `find_projects` 工具并设置 `refresh: true`
2. **Git 操作**: 在执行 Git 操作前,确保项目是 Git 仓库
3. **GitLab MR**: 创建 MR 需要正确的项目路径格式(如 `lanhuapp/master-web`)
4. **代码搜索**: 会自动排除 `node_modules`、`.git` 等目录
