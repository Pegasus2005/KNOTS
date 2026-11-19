import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
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
   * Resolve a file path flexibly across the PC (workspace, Desktop, Downloads, Documents)
   * while ensuring it passes safety guardrails.
   */
  private resolvePcPath(inputPath: string, contextHint?: string): { allowed: boolean; resolvedPath: string; error?: string } {
    let normalized = inputPath.trim();

    // If contextHint is targeting desktop and inputPath is not already absolute, route directly to Desktop
    if (contextHint && /\bdesktop\b/i.test(contextHint)) {
      if (!path.isAbsolute(normalized) && !/^[a-zA-Z]:/i.test(normalized)) {
        const cleanName = normalized.replace(/^(?:desktop|~\/desktop|\.\\desktop)[\\/]/i, '');
        normalized = path.join(os.homedir(), 'Desktop', cleanName);
      }
    }

    const rawCheck = this.guard.validatePath(normalized);
    if (!rawCheck.allowed) return rawCheck;

    if (existsSync(rawCheck.resolvedPath)) {
      return rawCheck;
    }

    // If relative and not in workspace, check common PC user folders
    if (!path.isAbsolute(normalized)) {
      const candidates = [
        path.join(os.homedir(), 'Desktop', normalized),
        path.join(os.homedir(), 'Downloads', normalized),
        path.join(os.homedir(), 'Documents', normalized),
        path.join(os.homedir(), normalized),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          const candCheck = this.guard.validatePath(candidate);
          if (candCheck.allowed) {
            return candCheck;
          }
        }
      }
    }

    return rawCheck;
  }

  /**
   * Helper to extract human-readable text from PDF files.
   */
  private extractPdfText(buffer: Buffer): string {
    const str = buffer.toString('latin1');
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match;
    let extracted = '';

    while ((match = streamRegex.exec(str)) !== null) {
      try {
        const streamBuf = Buffer.from(match[1], 'latin1');
        const inflated = zlib.inflateSync(streamBuf);
        const text = inflated.toString('utf-8');

        // Extract (text) Tj
        const tjMatches = text.match(/\((.*?)\)\s*Tj/g) || [];
        for (const m of tjMatches) {
          extracted += m.replace(/^\(/, '').replace(/\)\s*Tj$/, '') + ' ';
        }

        // Extract [(text)] TJ
        const tjArrayMatches = text.match(/\[(.*?)\]\s*TJ/g) || [];
        for (const m of tjArrayMatches) {
          const inner = m.match(/\((.*?)\)/g) || [];
          for (const item of inner) {
            extracted += item.slice(1, -1);
          }
          extracted += ' ';
        }
      } catch {
        // Stream not compressed or not text
      }
    }

    if (!extracted.trim()) {
      // Fallback: extract any visible ASCII text sequences >= 4 chars
      const asciiStrings = str.match(/[\x20-\x7E]{4,}/g) || [];
      extracted = asciiStrings
        .filter((s) => !s.startsWith('/Filter') && !s.startsWith('/Length') && !s.startsWith('/Type'))
        .join(' ');
    }

    return extracted.replace(/\\([0-9]{3})/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Search for files across the workspace and common PC directories (Desktop, Downloads).
   */
  async findFiles(query: string = '', maxResults: number = 60): Promise<ToolActionResult> {
    try {
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
        'appdata',
        'application data',
      ]);

      async function scanDir(currentDir: string, relativeDir: string = '', depth = 0) {
        if (results.length >= maxResults || depth > 5) return;
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
            if (!ignoredDirs.has(entry.name.toLowerCase())) {
              await scanDir(fullPath, relPath, depth + 1);
            }
          } else {
            if (!lowerQuery || relPath.toLowerCase().includes(lowerQuery) || entry.name.toLowerCase().includes(lowerQuery)) {
              results.push(fullPath.replace(/\\/g, '/'));
            }
          }
        }
      }

      // 1. Scan workspace root
      await scanDir(this.guard.getWorkspace(), '');

      // 2. Also scan Desktop and Downloads if query is looking for a specific file
      if (results.length === 0 || lowerQuery.length > 2) {
        const userFolders = [
          path.join(os.homedir(), 'Desktop'),
          path.join(os.homedir(), 'Downloads'),
        ];
        for (const uf of userFolders) {
          if (existsSync(uf)) {
            await scanDir(uf, '', 1);
          }
        }
      }

      return {
        success: true,
        action: 'find_files',
        target: query || '*',
        output: results.length > 0 ? results.join('\n') : `No files found matching '${query}' on PC`,
      };
    } catch (err: any) {
      return { success: false, action: 'find_files', target: query, error: err.message };
    }
  }

  /**
   * List files in a directory on the PC.
   */
  async listFiles(subPath: string = ''): Promise<ToolActionResult> {
    const check = this.resolvePcPath(subPath);
    if (!check.allowed) {
      return { success: false, action: 'list_files', target: subPath, error: check.error };
    }

    try {
      if (!existsSync(check.resolvedPath)) {
        return { success: false, action: 'list_files', target: subPath, error: `Directory does not exist: ${check.resolvedPath}` };
      }

      const entries = await fs.readdir(check.resolvedPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !['node_modules', '.git', 'dist', '.gemini', 'venv'].includes(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

      return {
        success: true,
        action: 'list_files',
        target: check.resolvedPath,
        output: filtered.join('\n') || '(empty directory)',
      };
    } catch (err: any) {
      return { success: false, action: 'list_files', target: subPath, error: err.message };
    }
  }

  /**
   * Read contents of any file on the PC (code, text, docs, or PDFs).
   */
  async readFile(filePath: string, contextHint?: string): Promise<ToolActionResult> {
    let targetPath = filePath.trim();
    if (contextHint && /\bdesktop\b/i.test(contextHint)) {
      if (!path.isAbsolute(targetPath) && !targetPath.includes('/') && !targetPath.includes('\\')) {
        const desktopCand = path.join(os.homedir(), 'Desktop', targetPath);
        if (existsSync(desktopCand)) {
          targetPath = desktopCand;
        }
      }
    }

    const check = this.resolvePcPath(targetPath, contextHint);
    if (!check.allowed) {
      return { success: false, action: 'read_file', target: filePath, error: check.error };
    }

    try {
      if (!existsSync(check.resolvedPath)) {
        return {
          success: false,
          action: 'read_file',
          target: filePath,
          error: `File not found at '${filePath}' (resolved: '${check.resolvedPath}'). Use find_files to locate it.`,
        };
      }

      const stat = await fs.stat(check.resolvedPath);
      if (stat.size > 10 * 1024 * 1024) {
        return { success: false, action: 'read_file', target: filePath, error: 'File exceeds 10MB limit.' };
      }

      const buffer = await fs.readFile(check.resolvedPath);

      // Handle PDF text extraction
      if (check.resolvedPath.toLowerCase().endsWith('.pdf') || buffer.slice(0, 5).toString() === '%PDF-') {
        const text = this.extractPdfText(buffer);
        return {
          success: true,
          action: 'read_file',
          target: check.resolvedPath,
          output: text || '(PDF contains no readable text or is scanned/image-only)',
        };
      }

      // Handle standard text / source code
      const content = buffer.toString('utf-8');
      return { success: true, action: 'read_file', target: check.resolvedPath, output: content };
    } catch (err: any) {
      return { success: false, action: 'read_file', target: filePath, error: err.message };
    }
  }

  /**
   * Edit an existing file on the PC by replacing exact target text.
   */
  async editFile(filePath: string, target: string, replacement: string, contextHint?: string): Promise<ToolActionResult> {
    let targetPath = filePath.trim();
    if (contextHint && /\bdesktop\b/i.test(contextHint)) {
      if (!path.isAbsolute(targetPath) && !targetPath.includes('/') && !targetPath.includes('\\')) {
        const desktopCand = path.join(os.homedir(), 'Desktop', targetPath);
        if (existsSync(desktopCand)) {
          targetPath = desktopCand;
        }
      }
    }

    const check = this.resolvePcPath(targetPath, contextHint);
    if (!check.allowed) {
      return { success: false, action: 'edit_file', target: filePath, error: check.error };
    }

    try {
      if (!existsSync(check.resolvedPath)) {
        return { success: false, action: 'edit_file', target: filePath, error: `File not found: ${check.resolvedPath}` };
      }

      const original = await fs.readFile(check.resolvedPath, 'utf-8');
      if (!original.includes(target)) {
        return {
          success: false,
          action: 'edit_file',
          target: filePath,
          error: `Target text not found in ${path.basename(filePath)}. Please use read_file first to check exact contents.`,
        };
      }

      const updated = original.replace(target, replacement);
      await fs.writeFile(check.resolvedPath, updated, 'utf-8');

      return {
        success: true,
        action: 'edit_file',
        target: check.resolvedPath,
        output: `Successfully updated ${path.basename(filePath)}`,
      };
    } catch (err: any) {
      return { success: false, action: 'edit_file', target: filePath, error: err.message };
    }
  }

  /**
   * Write text contents to a file (creates parent directories if needed).
   */
  async writeFile(filePath: string, content: string, contextHint?: string): Promise<ToolActionResult> {
    let targetPath = filePath.trim();
    if (contextHint && /\bdesktop\b/i.test(contextHint)) {
      if (!path.isAbsolute(targetPath) && !targetPath.includes('/') && !targetPath.includes('\\')) {
        targetPath = path.join(os.homedir(), 'Desktop', targetPath);
      }
    }

    const check = this.resolvePcPath(targetPath, contextHint);
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
        target: check.resolvedPath,
        output: `Successfully wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${check.resolvedPath}`,
      };
    } catch (err: any) {
      return { success: false, action: 'write_file', target: filePath, error: err.message };
    }
  }

  /**
   * Search the live internet for information, docs, and references.
   */
  async webSearch(query: string): Promise<ToolActionResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { success: false, action: 'web_search', target: query, error: 'Empty search query.' };
    }

    const results: string[] = [];

    // 1. DuckDuckGo Instant Answer
    try {
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.startsWith('{')) {
          const data = JSON.parse(text) as any;
          if (data.AbstractText) {
            results.push(`Summary: ${data.AbstractText}\nSource: ${data.AbstractURL || 'Instant Answer'}`);
          }
          if (Array.isArray(data.RelatedTopics)) {
            for (const item of data.RelatedTopics.slice(0, 4)) {
              if (item.Text && item.FirstURL) {
                results.push(`• ${item.Text}\n  ${item.FirstURL}`);
              }
            }
          }
        }
      }
    } catch {}

    // 2. Wikipedia Web Search (authoritative encyclopedic knowledge)
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmed)}&format=json&utf8=1`;
      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'KNOTSSwarm/1.0 (https://knots.local; agent@knots.local)' },
      });
      if (wikiRes.ok) {
        const wikiData = (await wikiRes.json()) as any;
        const searchItems = wikiData?.query?.search || [];
        for (const item of searchItems.slice(0, 4)) {
          const cleanSnippet = (item.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
          results.push(`[${item.title}]: ${cleanSnippet}\nURL: https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`);
        }
      }
    } catch {}

    const output = results.length > 0
      ? results.join('\n\n')
      : `Search completed for '${query}', but no instant summaries were returned. Use fetch_url on a direct URL for more details.`;

    return {
      success: true,
      action: 'web_search',
      target: query,
      output,
    };
  }

  /**
   * Fetch any live webpage or API on the internet and return clean readable text.
   */
  async fetchUrl(url: string): Promise<ToolActionResult> {
    try {
      let targetUrl = url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = `https://${targetUrl}`;
      }

      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KNOTS/0.1' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { success: false, action: 'fetch_url', target: url, error: `HTTP ${res.status} ${res.statusText}` };
      }

      const raw = await res.text();
      // Strip script, style, and HTML tags for clean text
      const clean = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      const truncated = clean.length > 8000 ? clean.slice(0, 8000) + '... (truncated)' : clean;

      return {
        success: true,
        action: 'fetch_url',
        target: url,
        output: truncated || '(empty webpage)',
      };
    } catch (err: any) {
      return { success: false, action: 'fetch_url', target: url, error: err.message };
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
        maxBuffer: 2 * 1024 * 1024,
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
