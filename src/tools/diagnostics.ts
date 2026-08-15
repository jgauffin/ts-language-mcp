import type { DiagnosticSeverity } from '../types.js';
import type { ToolModule } from './context.js';
import { TOOL_SCHEMAS } from './schemas.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clamp(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

/**
 * Tools reporting what is wrong with the code, from TypeScript and ESLint.
 */
export const diagnosticsTools: ToolModule = {
  definitions: [
    {
      name: 'get_diagnostics',
      description:
        'Get TypeScript + ESLint errors and warnings for a file. ' +
        'ESLint results are included when ESLint is installed in the target project. ' +
        'Results are sorted by severity and capped at the top 50 most severe by default.',
      inputSchema: TOOL_SCHEMAS.diagnosticsFileParams,
    },
    {
      name: 'get_all_diagnostics',
      description:
        'Get TypeScript + ESLint errors and warnings for all files in the project. ' +
        'Useful for checking project health after changes. ' +
        'Results are sorted by severity (errors first) and capped at the top 50 most severe by default — ' +
        'summary.total reflects the true total and summary.truncated indicates when the cap was hit.',
      inputSchema: TOOL_SCHEMAS.allDiagnosticsParams,
    },
  ],

  handlers: {
    get_diagnostics: async (args, ctx) => {
      const p = args as {
        file: string;
        includeEslint?: boolean;
        limit?: number;
        includeSuggestions?: boolean;
      };

      // Fetch beyond the cap so the caller learns how much was held back
      // rather than silently receiving a partial list.
      const all = await ctx.languageService.getDiagnostics(p.file, {
        includeEslint: p.includeEslint,
        includeSuggestions: p.includeSuggestions,
        limit: MAX_LIMIT,
      });

      const limit = clamp(p.limit);
      const diagnostics = all.slice(0, limit);

      return {
        diagnostics,
        total: all.length,
        returned: diagnostics.length,
        truncated: diagnostics.length < all.length,
      };
    },

    get_all_diagnostics: async (args, ctx) => {
      const p = args as {
        severity?: DiagnosticSeverity;
        includeEslint?: boolean;
        limit?: number;
        includeSuggestions?: boolean;
      };
      return ctx.languageService.getAllDiagnostics(p.severity, {
        includeEslint: p.includeEslint,
        includeSuggestions: p.includeSuggestions,
        limit: p.limit,
      });
    },
  },
};
