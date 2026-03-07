/**
 * MCP 客户端管理器
 * 用于连接和管理多个 MCP Server（如 GitHub、GitLab 等）
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class MCPClientManager {
  constructor() {
    this.clients = new Map(); // serverName -> { client, transport, tools }
    this.toolsCache = []; // 缓存所有 MCP 工具定义
  }

  /**
   * 连接到 MCP Server
   * @param {string} name - 服务名称（如 'github'）
   * @param {string} command - 启动命令（如 'npx'）
   * @param {string[]} args - 命令参数
   * @param {object} env - 环境变量
   */
  async connectToServer(name, command, args, env = {}) {
    try {
      console.log(`🔌 正在连接 MCP Server: ${name}...`);

      const transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env, ...env },
      });

      const client = new Client({
        name: `feishu-agent-${name}`,
        version: "1.0.0",
      });

      await client.connect(transport);

      // 获取该 server 提供的所有工具
      const { tools } = await client.listTools();

      this.clients.set(name, { client, transport, tools });

      console.log(
        `✅ 已连接 ${name}，可用工具:`,
        tools.map((t) => t.name)
      );

      // 更新工具缓存
      this._updateToolsCache();

      return tools;
    } catch (error) {
      console.error(`❌ 连接 MCP Server ${name} 失败:`, error.message);
      throw error;
    }
  }

  /**
   * 更新工具缓存
   */
  _updateToolsCache() {
    this.toolsCache = [];
    for (const [serverName, { tools }] of this.clients) {
      for (const tool of tools) {
        this.toolsCache.push({
          name: `mcp_${serverName}__${tool.name}`,
          description: `[MCP:${serverName}] ${tool.description}`,
          input_schema: tool.inputSchema,
        });
      }
    }
  }

  /**
   * 获取所有 MCP 工具定义（Anthropic 格式）
   */
  getAllTools() {
    return this.toolsCache;
  }

  /**
   * 判断是否是 MCP 工具
   */
  isMCPTool(toolName) {
    return toolName.startsWith("mcp_");
  }

  /**
   * 执行 MCP 工具调用
   * @param {string} toolName - 工具名称（格式：mcp_serverName__toolName）
   * @param {object} args - 工具参数
   */
  async callTool(toolName, args) {
    // 解析工具名称：mcp_github__create_issue -> github, create_issue
    const match = toolName.match(/^mcp_([^_]+)__(.+)$/);
    if (!match) {
      throw new Error(`Invalid MCP tool name format: ${toolName}`);
    }

    const [, serverName, actualToolName] = match;

    const serverData = this.clients.get(serverName);
    if (!serverData) {
      throw new Error(`MCP Server not connected: ${serverName}`);
    }

    try {
      const result = await serverData.client.callTool({
        name: actualToolName,
        arguments: args,
      });

      // 处理返回结果
      if (Array.isArray(result.content)) {
        return result.content
          .map((item) => {
            if (item.type === "text") return item.text;
            return JSON.stringify(item);
          })
          .join("\n");
      }

      return JSON.stringify(result.content);
    } catch (error) {
      return `MCP tool error: ${error.message}`;
    }
  }

  /**
   * 断开所有 MCP Server 连接
   */
  async disconnectAll() {
    for (const [name, { client }] of this.clients) {
      try {
        await client.close();
        console.log(`🔌 已断开 MCP Server: ${name}`);
      } catch (error) {
        console.error(`断开 ${name} 失败:`, error.message);
      }
    }
    this.clients.clear();
    this.toolsCache = [];
  }

  /**
   * 获取已连接的服务列表
   */
  getConnectedServers() {
    return Array.from(this.clients.keys());
  }
}

// 单例导出
export const mcpManager = new MCPClientManager();

/**
 * 初始化所有配置的 MCP Server
 * @param {object} mcpConfig - MCP 配置
 */
export async function initMCPServers(mcpConfig) {
  if (!mcpConfig || !mcpConfig.servers) {
    console.log("ℹ️ 未配置 MCP Servers，跳过初始化");
    return;
  }

  for (const [name, serverConfig] of Object.entries(mcpConfig.servers)) {
    if (!serverConfig.enabled) {
      console.log(`⏭️ MCP Server ${name} 已禁用，跳过`);
      continue;
    }

    try {
      await mcpManager.connectToServer(
        name,
        serverConfig.command,
        serverConfig.args,
        serverConfig.env || {}
      );
    } catch (error) {
      console.error(`⚠️ MCP Server ${name} 初始化失败，继续启动...`);
    }
  }
}
