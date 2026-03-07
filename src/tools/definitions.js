/**
 * 工具定义 - 告诉 AI 有哪些工具可用
 */
export const TOOLS = [
  {
    name: "bash",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read file contents.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace exact text in file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "find_file",
    description: "Find files by name pattern.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        dir: { type: "string" },
      },
      required: ["pattern"],
    },
  },

  // ============ 项目管理工具 ============
  {
    name: "find_projects",
    description: "Scan and list all available projects in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        refresh: { type: "boolean", description: "Force refresh cache" },
      },
    },
  },
  {
    name: "open_project",
    description: "Switch to a specific project by name.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name (e.g., 'master-web')" },
      },
      required: ["name"],
    },
  },
  {
    name: "search_code",
    description: "Search for code in current project.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Search keyword or pattern" },
        file_pattern: { type: "string", description: "File pattern filter (e.g., '*.js', '*.tsx')" },
        max_results: { type: "integer", description: "Maximum results to return (default: 50)" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "search_all_projects",
    description: "Search for code across all projects.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Search keyword or pattern" },
        project_filter: { type: "string", description: "Filter by project name (optional)" },
        max_results: { type: "integer", description: "Maximum results per project (default: 20)" },
      },
      required: ["keyword"],
    },
  },

  // ============ IDE 工具 ============
  {
    name: "open_in_ide",
    description: "Open file or project in IDE (Windsurf or Cursor).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory path to open" },
        ide: { type: "string", description: "IDE to use: 'windsurf' or 'cursor' (default: windsurf)" },
      },
      required: ["path"],
    },
  },

  // ============ Skills 系统 ============
  {
    name: "load_skill",
    description: "Load specialized knowledge and workflow guidance by skill name. Use this before tackling complex tasks.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name to load (e.g., 'git-workflow', 'project-management', 'code-search')",
        },
      },
      required: ["name"],
    },
  },
];
