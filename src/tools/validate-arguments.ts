/**
 * Checks tool arguments against the tool's own input schema before dispatch.
 *
 * MCP clients are not obliged to enforce the schema, so an agent that omits an
 * argument reaches the handler with it missing. Without this the failure is
 * whatever the handler trips over first, and a missing `newName` even reached
 * disk as the literal text "undefined".
 */

/** The subset of JSON Schema the tool definitions actually use. */
interface ArgumentSchema {
  type?: string;
  properties?: Record<string, PropertySchema>;
  required?: readonly string[];
  anyOf?: readonly RequiredGroup[];
  items?: ArgumentSchema;
}

interface PropertySchema extends ArgumentSchema {
  description?: string;
}

interface RequiredGroup {
  required?: readonly string[];
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  boolean: (value) => typeof value === 'boolean',
};

/**
 * Throws when `args` does not satisfy `schema`, naming the argument at fault.
 *
 * Runs before a `symbol` argument is resolved into coordinates, because
 * resolving one manufactures the very file/line/column the schema demands.
 */
export function validateArguments(toolName: string, schema: unknown, args: unknown): void {
  validate(toolName, '', asSchema(schema), args);
}

function validate(toolName: string, argumentPath: string, schema: ArgumentSchema, value: unknown): void {
  const where = argumentPath ? `${toolName}: ${argumentPath}` : toolName;

  if (!TYPE_CHECKS.object(value)) {
    throw new Error(`${where} expects an object of arguments, received ${describe(value)}.`);
  }
  const args = value as Record<string, unknown>;

  for (const name of schema.required ?? []) {
    if (isMissing(args[name])) {
      throw new Error(`${where} requires "${name}".${hint(schema, name)}`);
    }
  }

  requireOneGroup(where, schema, args);

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const supplied = args[name];
    if (isMissing(supplied)) continue;

    const check = property.type ? TYPE_CHECKS[property.type] : undefined;
    if (check && !check(supplied)) {
      throw new Error(
        `${where} expects "${name}" to be ${article(property.type as string)}, ` +
          `received ${describe(supplied)}.${hint(schema, name)}`
      );
    }

    if (Array.isArray(supplied) && property.items?.properties) {
      supplied.forEach((entry, index) =>
        validate(toolName, `${name}[${index}]`, property.items as ArgumentSchema, entry)
      );
    }
  }
}

/**
 * `anyOf` in these schemas always lists alternative sets of required
 * arguments, such as file+line+column or symbol.
 */
function requireOneGroup(where: string, schema: ArgumentSchema, args: Record<string, unknown>): void {
  const groups = (schema.anyOf ?? [])
    .map((group) => group.required ?? [])
    .filter((names) => names.length > 0);
  if (groups.length === 0) return;

  const satisfied = groups.some((names) => names.every((name) => !isMissing(args[name])));
  if (satisfied) return;

  const alternatives = groups.map((names) => names.join('+')).join(' or ');
  throw new Error(`${where} requires ${alternatives}.`);
}

/** The property's own description, so the caller reads the accepted shape. */
function hint(schema: ArgumentSchema, name: string): string {
  const description = schema.properties?.[name]?.description;
  return description ? ` ${description}` : '';
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return article(typeof value);
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function asSchema(schema: unknown): ArgumentSchema {
  return TYPE_CHECKS.object(schema) ? (schema as ArgumentSchema) : {};
}
