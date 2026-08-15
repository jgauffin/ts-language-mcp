/**
 * Minimal YAML serializer for tool results.
 * Handles objects, arrays, strings, numbers, booleans, null.
 * Uses 1-space indentation.
 *
 * The contract this file owes its callers: whatever an MCP client parses back
 * must equal what we serialized. That means quoting any string a YAML parser
 * would otherwise resolve to a boolean, number or null.
 */

/** Characters that start a YAML indicator and force quoting at position 0. */
const INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;

/** Words YAML 1.1 parsers resolve to booleans or null. */
const AMBIGUOUS_KEYWORD = /^(?:true|false|yes|no|on|off|null|~)$/i;

/** Decimal, float and exponent forms a parser would turn into a number. */
const NUMBER_LIKE = /^[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Hex, octal and binary integer forms. */
const RADIX_LIKE = /^[+-]?0[xXoObB][0-9a-fA-F_]+$/;

/** Sexagesimal forms such as 1:30, which YAML 1.1 reads as a number. */
const SEXAGESIMAL_LIKE = /^[+-]?\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?$/;

function needsQuoting(value: string): boolean {
  if (value === '') return true;
  // Leading or trailing whitespace is not preserved by plain scalars.
  if (value !== value.trim()) return true;
  if (/[\n\r\t]/.test(value)) return true;
  if (INDICATOR_START.test(value)) return true;
  // ": " ends a key and " #" starts a comment, neither valid inside a plain scalar.
  if (value.includes(': ') || value.endsWith(':')) return true;
  if (value.includes(' #')) return true;
  if (AMBIGUOUS_KEYWORD.test(value)) return true;
  if (NUMBER_LIKE.test(value) || RADIX_LIKE.test(value) || SEXAGESIMAL_LIKE.test(value)) return true;
  return false;
}

function quoteString(value: string): string {
  return needsQuoting(value) ? JSON.stringify(value) : value;
}

/** True for anything rendered inline rather than as an indented block. */
function isInlineValue(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.length === 0;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

function renderInline(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    // NaN and Infinity have no portable plain form; emit them as strings.
    return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  }
  if (typeof value === 'string') return quoteString(value);
  if (Array.isArray(value)) return '[]';
  if (typeof value === 'object') return '{}';
  return quoteString(String(value));
}

/**
 * Renders a value as a block in which every line carries `indent` spaces.
 * Callers splice a "- " into the first line by slicing off that leading pad.
 */
function renderBlock(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent);

  if (isInlineValue(value)) {
    return pad + renderInline(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isInlineValue(item)) {
          return `${pad}- ${renderInline(item)}`;
        }
        // Nested collections (objects and arrays alike) render one level in,
        // then the "- " replaces that level's padding on the first line.
        const block = renderBlock(item, indent + 2);
        return `${pad}- ${block.slice(indent + 2)}`;
      })
      .join('\n');
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return entries
    .map(([key, val]) => {
      const renderedKey = quoteString(key);
      if (isInlineValue(val)) {
        return `${pad}${renderedKey}: ${renderInline(val)}`;
      }
      return `${pad}${renderedKey}:\n${renderBlock(val, indent + 1)}`;
    })
    .join('\n');
}

export function toYaml(value: unknown, indent = 0): string {
  return renderBlock(value, indent);
}
