/**
 * Standalone position conversion utilities.
 * Converts between 1-based line/column and 0-based offset representations.
 */

/**
 * Converts 1-based line/column to 0-based character offset.
 */
export function getOffset(content: string, line: number, column: number): number {
  const lines = content.split('\n');
  let offset = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  return offset + (column - 1);
}

/**
 * Converts 0-based character offset to 1-based line/column.
 */
export function getLineColumn(content: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;

  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }

  return { line, column: offset - lastNewline };
}
