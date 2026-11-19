import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { SafetyGuard } from './safety-guard.js';

const execAsync = promisify(exec);

export interface ToolActionResult {
  success: boolean;
  action: string;
  target?: string;
  output?: string;
  error?: string;
}

export class ToolExecutor {
  private guard: SafetyGuard;

  constructor(workspaceRoot?: string) {
    this.guard = new SafetyGuard(workspaceRoot);
  }

  getWorkspace(): string {
    return this.guard.getWorkspace();
  }

  setWorkspace(dir: string): void {
    this.guard.setWorkspace(dir);
  }

  /**
   * Recursively search for files in the workspace matching a query, keyword, or extension.
   */
  async findFiles(query: string = '', maxResults: number = 60): Promise<ToolActionResult> {
    try {
      const root = this.guard.getWorkspace();
      const results: string[] = [];
      const lowerQuery = query.toLowerCase().trim().replace(/^\*\.?/, '');

      const ignoredDirs = new Set([
        'node_modules',
        '.git',
        'dist',
        '.gemini',
        'venv',
        '.turbo',
        '.cache',
        'build',
        'coverage',
      ]);

      async function scan(currentDir: string, relativeDir: string = '') {
        if (results.length >= maxResults) return;
        let entries;
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) return;
          if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

          const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) {
              await scan(fullPath, relPath);
            }
          } else {
            if (!lowerQuery || relPath.toLowerCase().includes(lowerQuery) || entry.name.toLowerCase().includes(lowerQuery)) {
              results.push(relPath);
            }
          }
        }
      }

      await scan(root);

      return {
        success: true,
        action: 'find_files',
        target: query || '*',
        output: results.length > 0 ? results.join('\n') : `No files found matching '${query}' in ${root}`,
      };
    } catch (err: any) {
      return { success: false, action: 'find_files', target: query, error: err.message };
    }
  }

  /**
   * List files and folders in a workspace directory.
   */
  async listFiles(subPath: string = ''): Promise<ToolActionResult> {
    const check = this.guard.validatePath(subPath);
    if (!check.allowed) {
      return { success: false, action: 'list_files', target: subPath, error: check.error };
    }

    try {
      if (!existsSync(check.resolvedPath)) {
        return { success: false, action: 'list_files', target: subPath, error: 'Directory does not exist.' };
      }

      const entries = await fs.readdir(check.resolvedPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !['node_modules', '.git', 'dist', '.gemini', 'venv'].includes(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

      return {
        success: true,
        action: 'list_files',
        target: subPath,
        output: filtered.join('\n') || '(empty directory)',
      };
    } catch (err: any) {
      return { success: false, action: 'list_files', target: subPath, error: err.message };
    }
  }

  /**
   * Read text contents of a file within the workspace.
   */
  async readFile(filePath: string): Promise<ToolActionResult> {
    const check = this.guard.validatePath(filePath);
    if (!check.allowed) {
      return { success: false, action: 'read_file', target: filePath, error: check.error };
    }

    try {
      if (!existsSync(check.resolvedPath)) {
        return { success: false, action: 'read_file', target: filePath, error: 'File does not exist.' };
      }

      const stat = await fs.stat(check.resolvedPath);
      if (stat.size > 2 * 1024 * 1024) {
        return { success: false, action: 'read_file', target: filePath, error: 'File exceeds 2MB limit.' };
      }

      const content = await fs.readFile(check.resolvedPath, 'utf-8');
      return { success: true, action: 'read_file', target: filePath, output: content };
    } catch (err: any) {
      return { success: false, action: 'read_file', target: filePath, error: err.message };
    }
  }

  /**
   * Write text contents to a file inside the workspace (creates parent dirs if needed).
   */
  async writeFile(filePath: string, content: string): Promise<ToolActionResult> {
    const check = this.guard.validatePath(filePath);
    if (!check.allowed) {
      return { success: false, action: 'write_file', target: filePath, error: check.error };
    }

    try {
      const parentDir = path.dirname(check.resolvedPath);
      await fs.mkdir(parentDir, { recursive: true });
      await fs.writeFile(check.resolvedPath, content, 'utf-8');

      return {
        success: true,
        action: 'write_file',
        target: filePath,
        output: `Successfully wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${filePath}`,
      };
    } catch (err: any) {
      return { success: false, action: 'write_file', target: filePath, error: err.message };
    }
  }

  /**
   * Execute a shell command inside the workspace folder.
   */
  async runCommand(command: string): Promise<ToolActionResult> {
    const check = this.guard.validateCommand(command);
    if (!check.allowed) {
      return { success: false, action: 'run_command', target: command, error: check.error };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.guard.getWorkspace(),
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });

      const combined = [stdout.trim(), stderr ? `[stderr]:\n${stderr.trim()}` : '']
        .filter(Boolean)
        .join('\n');

      return {
        success: true,
        action: 'run_command',
        target: command,
        output: combined || '(command completed with no output)',
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'run_command',
        target: command,
        error: `Exit code ${err.code || 1}: ${err.stderr || err.message}`,
      };
    }
  }
}

