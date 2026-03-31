/**
 * Minimal YAML serializer for tool results.
 * Handles objects, arrays, strings, numbers, booleans, null.
 * Uses 1-space indentation.
 */

const NEEDS_QUOTING = /^[@*&!{[>|'"%,`#~?]|[:\s]|^$/;

function quoteString(value: string): string {
  if (value.includes('\n') || NEEDS_QUOTING.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function toYaml(value: unknown, indent = 0): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return quoteString(value);

  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const lines: string[] = [];
    for (const item of value) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Render object as block under "- " prefix
        // The content after "- " is at indent + 2
        const objYaml = renderObject(item as Record<string, unknown>, indent + 2);
        // Splice "- " into the first line
        const objLines = objYaml.split('\n');
        const firstLine = objLines[0];
        const stripped = firstLine.slice(indent + 2); // remove leading padding
        lines.push(`${pad}- ${stripped}`);
        for (let i = 1; i < objLines.length; i++) {
          lines.push(objLines[i]);
        }
      } else {
        lines.push(`${pad}- ${toYaml(item, indent + 2)}`);
      }
    }
    return lines.join('\n');
  }

  if (typeof value === 'object') {
    return renderObject(value as Record<string, unknown>, indent);
  }

  return String(value);
}

function renderObject(obj: Record<string, unknown>, indent: number): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const [key, val] of entries) {
    if (isInline(val)) {
      lines.push(`${pad}${key}: ${toYaml(val)}`);
    } else {
      lines.push(`${pad}${key}:\n${toYaml(val, indent + 1)}`);
    }
  }
  return lines.join('\n');
}

function isInline(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
