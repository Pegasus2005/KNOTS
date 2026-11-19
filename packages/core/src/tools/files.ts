import { readdir, realpath, open } from 'node:fs/promises';
import { relative, isAbsolute, resolve } from 'node:path';

export type FileAction =
  | { tool: 'list_files'; path: string }
  | { tool: 'read_file'; path: string }
  | { tool: 'create_file'; path: string; content: string };

export function parseFileAction(value: unknown, allowed: string[]): FileAction {
  if (!value || typeof value !== 'object') throw new Error('Invalid tool action.');
  const action = value as Record<string, unknown>;
  if (
    typeof action.tool !== 'string' ||
    !allowed.includes(action.tool) ||
    typeof action.path !== 'string'
  ) {
    throw new Error('The model requested an unavailable tool or invalid path.');
  }
  if (action.tool === 'create_file' && typeof action.content !== 'string') {
    throw new Error('create_file requires text content.');
  }
  return action as unknown as FileAction;
}

export async function readFolderAction(
  action: Exclude<FileAction, { tool: 'create_file' }>,
  root: string,
): Promise<string> {
  const path = await realpath(resolve(root, action.path));
  const within = relative(root, path);
  if (
    within === '..' ||
    within.startsWith('../') ||
    within.startsWith('..\\') ||
    isAbsolute(within)
  ) {
    throw new Error('The requested path is outside the granted folder.');
  }
  if (action.tool === 'list_files') {
    const entries = await readdir(path, { withFileTypes: true });
    return (
      JSON.stringify(
        entries.slice(0, 200).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        })),
      ) + (entries.length > 200 ? '\nListing limited to 200 entries.' : '')
    );
  }
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536)
      throw new Error('Read a regular text file up to 64 KB.');
    const data = await file.readFile();
    if (data.includes(0)) throw new Error('Binary files are unsupported by read_file.');
    return data.toString('utf8');
  } finally {
    await file.close();
  }
}
