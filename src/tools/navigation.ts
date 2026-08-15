import type { PositionParams } from '../types.js';
import type { ToolModule } from './context.js';
import { BY_SYMBOL_NOTE, TOOL_SCHEMAS } from './schemas.js';
import { paginate } from './paginate.js';

/**
 * Tools for moving around the codebase: definitions, references,
 * implementations, and the call/type hierarchies.
 */
export const navigationTools: ToolModule = {
  definitions: [
    {
      name: 'get_definition',
      description:
        'Find where a symbol is defined. Jump from usage to declaration.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_references',
      description:
        'Find all usages of a symbol across the project. ' +
        'Each reference includes its kind: "definition", "read", or "write", ' +
        'and the source line it sits on.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.pagedPositionParams,
    },
    {
      name: 'get_type_definition',
      description:
        'Jump to the declaration of a symbol\'s TYPE rather than of the symbol itself. ' +
        'For `const u = getUser()` this lands on the User interface, where ' +
        'get_definition lands on the variable.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_implementations',
      description:
        'Find all implementations of an interface or abstract method. ' +
        'Useful for understanding polymorphic code.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_call_hierarchy',
      description:
        'Get call hierarchy for a function/method. ' +
        'Direction: "incoming" shows who calls this, "outgoing" shows what this calls.' +
        BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.callHierarchyParams,
    },
    {
      name: 'get_type_hierarchy',
      description:
        'Get type hierarchy for a class/interface. ' +
        'Direction: "supertypes" shows parents, "subtypes" shows implementations/extensions.' +
        BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.typeHierarchyParams,
    },
  ],

  handlers: {
    get_definition: (args, ctx) => {
      const p = args as unknown as PositionParams;
      const definitions = ctx.languageService.getDefinitions(p.file, p.line, p.column);
      return {
        // "definition" stays for the common single-declaration case; overloads
        // and merged declarations need the full list.
        definition: definitions[0] ?? null,
        definitions,
        count: definitions.length,
      };
    },

    get_references: (args, ctx) => {
      const p = args as unknown as PositionParams & {
        limit?: number;
        offset?: number;
        contextLines?: number;
      };
      const all = ctx.languageService.getReferences(
        p.file,
        p.line,
        p.column,
        p.contextLines ?? 0
      );
      const { page, ...meta } = paginate(all, p.limit, p.offset);
      return { references: page, ...meta };
    },

    get_type_definition: (args, ctx) => {
      const p = args as unknown as PositionParams;
      const result = ctx.languageService.getTypeDefinition(p.file, p.line, p.column);
      return { definitions: result, count: result.length };
    },

    get_implementations: (args, ctx) => {
      const p = args as unknown as PositionParams;
      const result = ctx.languageService.getImplementations(p.file, p.line, p.column);
      return { implementations: result, count: result.length };
    },

    get_call_hierarchy: (args, ctx) => {
      const p = args as unknown as PositionParams & { direction: 'incoming' | 'outgoing' };
      const result = ctx.languageService.getCallHierarchy(p.file, p.line, p.column, p.direction);
      return { calls: result, count: result.length };
    },

    get_type_hierarchy: (args, ctx) => {
      const p = args as unknown as PositionParams & { direction: 'supertypes' | 'subtypes' };
      const result = ctx.languageService.getTypeHierarchy(p.file, p.line, p.column, p.direction);
      return { types: result, count: result.length };
    },
  },
};
