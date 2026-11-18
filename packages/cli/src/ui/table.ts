import chalk from 'chalk';

export interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  minWidth?: number;
  maxWidth?: number;
}

export interface TableOptions {
  columns: Column[];
  rows: Array<Record<string, unknown>>;
  emptyMessage?: string;
}

/**
 * Strip ANSI escape codes to measure string length correctly.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Pad a string to a given visible width.
 */
function pad(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const visibleLen = stripAnsi(str).length;
  if (visibleLen >= width) return str;

  const diff = width - visibleLen;
  if (align === 'right') {
    return ' '.repeat(diff) + str;
  }
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }
  return str + ' '.repeat(diff);
}

/**
 * Render a formatted console table with chalk styling.
 */
export function renderTable(options: TableOptions): void {
  const { columns, rows, emptyMessage = 'No records found.' } = options;

  if (rows.length === 0) {
    console.log(chalk.dim(emptyMessage));
    return;
  }

  // Calculate width for each column
  const widths: number[] = columns.map((col) => {
    let max = stripAnsi(col.header).length;
    for (const row of rows) {
      const val = row[col.key] != null ? String(row[col.key]) : '';
      const len = stripAnsi(val).length;
      if (len > max) max = len;
    }
    if (col.minWidth && max < col.minWidth) max = col.minWidth;
    if (col.maxWidth && max > col.maxWidth) max = col.maxWidth;
    return max;
  });

  // Top border
  const topBorder =
    '┌─' +
    widths.map((w) => '─'.repeat(w)).join('─┬─') +
    '─┐';
  const headerDivider =
    '├─' +
    widths.map((w) => '─'.repeat(w)).join('─┼─') +
    '─┤';
  const bottomBorder =
    '└─' +
    widths.map((w) => '─'.repeat(w)).join('─┴─') +
    '─┘';

  console.log(chalk.gray(topBorder));

  // Header row
  const headerCells = columns.map((col, idx) => {
    return chalk.bold.cyan(pad(col.header, widths[idx], col.align ?? 'left'));
  });
  console.log(chalk.gray('│ ') + headerCells.join(chalk.gray(' │ ')) + chalk.gray(' │'));

  console.log(chalk.gray(headerDivider));

  // Rows
  for (const row of rows) {
    const cells = columns.map((col, idx) => {
      const rawVal = row[col.key] != null ? String(row[col.key]) : '';
      return pad(rawVal, widths[idx], col.align ?? 'left');
    });
    console.log(chalk.gray('│ ') + cells.join(chalk.gray(' │ ')) + chalk.gray(' │'));
  }

  console.log(chalk.gray(bottomBorder));
}
