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
   * Expand user shortcuts such as ~, %USERPROFILE%, and shorthand folders (Desktop, Downloads, Documents).
   */
  normalizePath(targetPath: string): string {
    const trimmed = targetPath.trim();
    if (trimmed.startsWith('~')) {
      return path.join(os.homedir(), trimmed.slice(1).replace(/^[\\/]+/, ''));
    }
    if (trimmed.toLowerCase().startsWith('%userprofile%')) {
      return path.join(os.homedir(), trimmed.slice(13).replace(/^[\\/]+/, ''));
    }
    if (trimmed.toLowerCase().startsWith('desktop/') || trimmed.toLowerCase().startsWith('desktop\\')) {
      return path.join(os.homedir(), 'Desktop', trimmed.slice(8));
    }
    if (trimmed.toLowerCase() === 'desktop') {
      return path.join(os.homedir(), 'Desktop');
    }
    if (trimmed.toLowerCase().startsWith('downloads/') || trimmed.toLowerCase().startsWith('downloads\\')) {
      return path.join(os.homedir(), 'Downloads', trimmed.slice(10));
    }
    if (trimmed.toLowerCase().startsWith('documents/') || trimmed.toLowerCase().startsWith('documents\\')) {
      return path.join(os.homedir(), 'Documents', trimmed.slice(10));
    }
    return trimmed;
  }

  /**
   * Resolve and validate a path to make sure bots have access to the user's PC
   * (Desktop, Downloads, Documents, project folders, drives) while strictly blocking
   * critical operating system files and credentials.
   */
  validatePath(targetPath: string): { allowed: boolean; resolvedPath: string; error?: string } {
    const normalized = this.normalizePath(targetPath);
    let resolved = path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(this.workspaceRoot, normalized);

    const lowerResolved = resolved.toLowerCase();

    // 1. Strictly block critical system directories & credentials
    for (const forbidden of this.forbiddenPrefixes) {
      if (lowerResolved === forbidden || lowerResolved.startsWith(forbidden + path.sep)) {
        return {
          allowed: false,
          resolvedPath: resolved,
          error: `Safety Guardrail: Access denied to critical operating system location '${targetPath}'.`,
        };
      }
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

