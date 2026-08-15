import type { FindParams } from '../types.js';
import type { ToolModule } from './context.js';
import { TOOL_SCHEMAS } from './schemas.js';
import { paginate } from './paginate.js';

/**
 * Tools that describe the shape of the code: symbols, outlines,
 * imports, and symbol search.
 */
export const structureTools: ToolModule = {
  definitions: [
    {
      name: 'get_symbols',
      description:
        'List all symbols (functions, classes, etc.) defined in a file as a flat list. ' +
        'For hierarchical/nested structure, use get_outline instead.',
      inputSchema: TOOL_SCHEMAS.pagedFileParam,
    },
    {
      name: 'get_outline',
      description:
        'Get hierarchical structure/outline of a file. ' +
        'Returns nested symbols with their ranges.',
      inputSchema: TOOL_SCHEMAS.fileParam,
    },
    {
      name: 'get_imports',
      description:
        'List all imports in a file with their details (named imports, defaults, namespaces).',
      inputSchema: TOOL_SCHEMAS.fileParam,
    },
    {
      name: 'find',
      description:
        'Search for symbols in the AST by name pattern and kind. ' +
        'Supports glob patterns (*Service), regex (/^get/), and filtering by ' +
        'symbol kind (function, class, interface, string, comment, etc.) and export status.',
      inputSchema: TOOL_SCHEMAS.findParams,
    },
    {
      name: 'get_workspace_symbols',
      description:
        'Fast symbol search across the workspace by name. ' +
        'Faster than the find tool for simple name lookups. Supports fuzzy matching.',
      inputSchema: TOOL_SCHEMAS.workspaceSymbolsParams,
    },
  ],

  handlers: {
    get_symbols: (args, ctx) => {
      const p = args as { file: string; limit?: number; offset?: number };
      const all = ctx.languageService.getSymbols(p.file);
      const { page, ...meta } = paginate(all, p.limit, p.offset);
      return { symbols: page, ...meta };
    },

    get_outline: (args, ctx) => {
      const { file } = args as { file: string };
      return { outline: ctx.languageService.getOutline(file) };
    },

    get_imports: (args, ctx) => {
      const { file } = args as { file: string };
      const result = ctx.languageService.getImports(file);
      return { imports: result, count: result.length };
    },

    find: (args, ctx) => {
      const p = args as unknown as FindParams & { limit?: number; offset?: number };
      const all = ctx.astFinder.find(p);
      const { page, ...meta } = paginate(all, p.limit, p.offset);
      return { matches: page, count: page.length, ...meta };
    },

    get_workspace_symbols: (args, ctx) => {
      const { query, maxResults } = args as { query: string; maxResults?: number };
      const result = ctx.languageService.getWorkspaceSymbols(query, maxResults);
      return { symbols: result, count: result.length };
    },
  },
};
