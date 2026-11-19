import path from 'node:path';
import os from 'node:os';

/**
 * High-security path and command validator to ensure AI bots cannot
 * touch critical operating system files or execute destructive commands.
 */
export class SafetyGuard {
  private workspaceRoot: string;
  private forbiddenPrefixes: string[] = [];

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.initializeForbiddenPaths();
  }

  setWorkspace(newRoot: string): void {
    this.workspaceRoot = path.resolve(newRoot);
  }

  getWorkspace(): string {
    return this.workspaceRoot;
  }

  private initializeForbiddenPaths(): void {
    const isWindows = process.platform === 'win32';
    const home = os.homedir();

    const paths: string[] = [
      // Sensitive user credentials
      path.join(home, '.ssh'),
      path.join(home, '.aws'),
      path.join(home, '.gnupg'),
    ];

    if (isWindows) {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const programData = process.env.ProgramData || 'C:\\ProgramData';

      paths.push(
        systemRoot,
        path.join(systemRoot, 'System32'),
        path.join(systemRoot, 'SysWOW64'),
        programFiles,
        programFilesX86,
        programData,
        'C:\\Windows',
        'C:\\Recovery',
        'C:\\Boot',
      );
    } else {
      // Unix / macOS
      paths.push('/etc', '/bin', '/sbin', '/usr', '/var', '/System', '/Library', '/private');
    }

    this.forbiddenPrefixes = paths.map((p) => path.resolve(p).toLowerCase());
  }

  /**
   * Resolve and validate a path to make sure it's strictly inside the workspace
   * and never touching critical system files.
   */
  validatePath(targetPath: string): { allowed: boolean; resolvedPath: string; error?: string } {
    let resolved = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.workspaceRoot, targetPath);

    const lowerResolved = resolved.toLowerCase();
    const lowerWorkspace = this.workspaceRoot.toLowerCase();

    // 1. Check against critical system directories
    for (const forbidden of this.forbiddenPrefixes) {
      if (lowerResolved === forbidden || lowerResolved.startsWith(forbidden + path.sep)) {
        return {
          allowed: false,
          resolvedPath: resolved,
          error: `Access Denied: Path '${targetPath}' is a critical system file and cannot be accessed.`,
        };
      }
    }

    // 2. Prevent path traversal outside the workspace
    if (!lowerResolved.startsWith(lowerWorkspace)) {
      return {
        allowed: false,
        resolvedPath: resolved,
        error: `Access Denied: Path '${targetPath}' escapes the allowed project directory (${this.workspaceRoot}).`,
      };
    }

    return { allowed: true, resolvedPath: resolved };
  }

  /**
   * Check shell commands to block destructive or dangerous system modifications.
   */
  validateCommand(cmd: string): { allowed: boolean; error?: string } {
    const trimmed = cmd.trim();
    const lower = trimmed.toLowerCase();

    const DANGEROUS_PATTERNS = [
      /\bformat\b/i,
      /\bdiskpart\b/i,
      /\bbcdedit\b/i,
      /\breg\s+delete\b/i,
      /\bshutdown\b/i,
      /\breboot\b/i,
      /del\s+.*[c-z]:\\/i,
      /rmdir\s+.*[c-z]:\\/i,
      /rm\s+-rf\s+\//i,
      />\s*\\\\.\b/i,
      /powershell.*-encodedcommand/i,
    ];

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(lower)) {
        return {
          allowed: false,
          error: `Blocked potentially dangerous system command: "${trimmed}"`,
        };
      }
    }

    return { allowed: true };
  }
}

