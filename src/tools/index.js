import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import config from "../config/index.js";
import {
  scanAllProjects,
  findProjectPath,
  getAllProjects,
} from "../utils/project.js";

const execAsync = promisify(exec);

// 默认工作目录
let workDir = process.cwd();

/**
 * 设置工作目录
 */
export function setWorkDir(dir) {
  workDir = dir;
}

/**
 * 安全路径检查 - 防止路径逃逸到工作目录之外
 */
function safePath(p) {
  const fullPath = path.resolve(workDir, p);
  if (!fullPath.startsWith(workDir)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return fullPath;
}

/**
 * 执行 bash 命令
 */
export async function runBash(command) {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
  if (dangerous.some((d) => command.includes(d))) {
    return "Error: Dangerous command blocked";
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    });
    const output = (stdout + stderr).trim();
    return output ? output.slice(0, 50000) : "(no output)";
  } catch (error) {
    if (error.killed) {
      return "Error: Timeout (120s)";
    }
    const output = ((error.stdout || "") + (error.stderr || "")).trim();
    return output || `Error: ${error.message}`;
  }
}

/**
 * 读取文件内容
 */
export async function runRead(filePath, limit = null) {
  try {
    const fullPath = safePath(filePath);
    const text = await fs.readFile(fullPath, "utf-8");
    let lines = text.split("\n");

    if (limit && limit < lines.length) {
      lines = [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`];
    }

    return lines.join("\n").slice(0, 50000);
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 写入文件
 */
export async function runWrite(filePath, content) {
  try {
    const fullPath = safePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 编辑文件
 */
export async function runEdit(filePath, oldText, newText) {
  try {
    const fullPath = safePath(filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    if (!content.includes(oldText)) {
      return `Error: Text not found in ${filePath}`;
    }

    const newContent = content.replace(oldText, newText);
    await fs.writeFile(fullPath, newContent, "utf-8");
    return `Edited ${filePath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 查找文件
 */
export async function runFind(pattern, dir = ".") {
  try {
    const searchDir = safePath(dir);
    const { stdout, stderr } = await execAsync(
      `find "${searchDir}" -type f -iname "*${pattern}*" 2>/dev/null | head -50`,
      { cwd: workDir, timeout: 30000 }
    );
    const output = stdout.trim();
    if (!output) {
      return `No files found matching: ${pattern}`;
    }
    const files = output.split("\n").map((f) => path.relative(workDir, f));
    return `Found ${files.length} file(s):\n${files.join("\n")}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// ============ 项目管理工具 ============

/**
 * 查找所有项目
 */
export async function runFindProjects(refresh = false) {
  try {
    const projects = await scanAllProjects(refresh);
    const list = projects
      .map((p) => `- ${p.name} (${p.path})`)
      .join("\n");
    return `Found ${projects.length} projects:\n${list}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 打开项目
 */
export async function runOpenProject(name) {
  try {
    const project = await findProjectPath(name);
    workDir = project.path;
    return `Switched to project: ${project.name}\nPath: ${project.path}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * 在当前项目中搜索代码
 */
export async function runSearchCode(keyword, filePattern = null, maxResults = 50) {
  try {
    let grepCmd = `grep -rn "${keyword}" ${workDir}`;

    // 添加文件类型过滤
    if (filePattern) {
      grepCmd += ` --include="${filePattern}"`;
    }

    // 排除常见目录
    const excludeDirs = config.projects.excludeDirs;
    excludeDirs.forEach((dir) => {
      grepCmd += ` --exclude-dir="${dir}"`;
    });

    grepCmd += ` | head -${maxResults}`;

    const { stdout } = await execAsync(grepCmd, {
      cwd: workDir,
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
    });

    if (!stdout.trim()) {
      return `No results found for: ${keyword}`;
    }

    const lines = stdout.trim().split("\n");
    return `Found ${lines.length} matches:\n${stdout.slice(0, 10000)}`;
  } catch (error) {
    if (error.code === 1) {
      return `No results found for: ${keyword}`;
    }
    return `Error: ${error.message}`;
  }
}

/**
 * 在所有项目中搜索代码
 */
export async function runSearchAllProjects(keyword, projectFilter = null, maxResults = 20) {
  try {
    const allProjects = await getAllProjects();
    let projects = allProjects;

    // 过滤项目
    if (projectFilter) {
      projects = allProjects.filter((p) =>
        p.name.toLowerCase().includes(projectFilter.toLowerCase())
      );
    }

    const results = [];

    for (const project of projects) {
      try {
        let grepCmd = `grep -rn "${keyword}" "${project.path}"`;

        // 排除常见目录
        const excludeDirs = config.projects.excludeDirs;
        excludeDirs.forEach((dir) => {
          grepCmd += ` --exclude-dir="${dir}"`;
        });

        grepCmd += ` | head -${maxResults}`;

        const { stdout } = await execAsync(grepCmd, {
          timeout: 15000,
          maxBuffer: 1024 * 1024 * 2,
        });

        if (stdout.trim()) {
          results.push(`\n=== ${project.name} ===\n${stdout.trim()}`);
        }
      } catch (error) {
        // 忽略没有匹配的项目
      }
    }

    if (results.length === 0) {
      return `No results found for: ${keyword}`;
    }

    return `Found matches in ${results.length} project(s):\n${results.join("\n")}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// ============ IDE 工具 ============

/**
 * 在 IDE 中打开
 */
export async function runOpenInIDE(targetPath, ide = null) {
  try {
    const ideTool = ide || config.ide.defaultTool;

    if (!config.ide.supportedTools.includes(ideTool)) {
      return `Error: Unsupported IDE: ${ideTool}. Supported: ${config.ide.supportedTools.join(", ")}`;
    }

    const { stdout, stderr } = await execAsync(`${ideTool} "${targetPath}"`, {
      timeout: 10000,
    });

    return `Opened in ${ideTool}: ${targetPath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}
