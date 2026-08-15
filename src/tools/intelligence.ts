import type { PositionParams } from '../types.js';
import type { ToolModule } from './context.js';
import { BY_SYMBOL_NOTE, TOOL_SCHEMAS } from './schemas.js';

type AnalysisKind = 'hover' | 'definition' | 'references' | 'diagnostics' | 'signature';

const ALL_ANALYSES: AnalysisKind[] = [
  'hover', 'definition', 'references', 'diagnostics', 'signature',
];

/**
 * Tools that answer "what is this thing?" at a position:
 * type info, signatures, completions, and the combined analyses.
 */
export const intelligenceTools: ToolModule = {
  definitions: [
    {
      name: 'get_hover',
      description:
        'Get type information and documentation for a symbol. ' +
        'Returns the type signature and any JSDoc comments.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_completions',
      description:
        'Get code completion suggestions at a position. Context-aware suggestions.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'get_signature',
      description:
        'Get function signature help when cursor is inside a function call\'s parentheses. ' +
        'Shows parameter names, types, and which parameter is active based on cursor position.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'analyze_position',
      description:
        'Get comprehensive analysis at a position: hover info, definition, references, ' +
        'diagnostics, and signature help in one call.',
      inputSchema: TOOL_SCHEMAS.positionParams,
    },
    {
      name: 'batch_analyze',
      description:
        'Get hover, definition, references, diagnostics, and signature for multiple positions in one call. ' +
        'Use the "include" parameter to select which analyses to run (default: all).',
      inputSchema: TOOL_SCHEMAS.batchAnalyzeParams,
    },
  ],

  handlers: {
    get_hover: (args, ctx) => {
      const p = args as unknown as PositionParams;
      return { hover: ctx.languageService.getHover(p.file, p.line, p.column) ?? null };
    },

    get_completions: (args, ctx) => {
      const p = args as unknown as PositionParams;
      return { completions: ctx.languageService.getCompletions(p.file, p.line, p.column) };
    },

    get_signature: (args, ctx) => {
      const p = args as unknown as PositionParams;
      return { signature: ctx.languageService.getSignature(p.file, p.line, p.column) ?? null };
    },

    analyze_position: (args, ctx) => {
      const p = args as unknown as PositionParams;
      return ctx.languageService.analyzePosition(p.file, p.line, p.column);
    },

    batch_analyze: async (args, ctx) => {
      const p = args as unknown as {
        positions: PositionParams[];
        include?: AnalysisKind[];
      };
      const include = p.include ?? ALL_ANALYSES;
      const ls = ctx.languageService;

      const results = await Promise.all(
        p.positions.map(async (pos) => {
          const analysis: Record<string, unknown> = {
            file: pos.file,
            line: pos.line,
            column: pos.column,
          };

          if (include.includes('hover')) {
            analysis.hover = ls.getHover(pos.file, pos.line, pos.column) ?? null;
          }
          if (include.includes('definition')) {
            analysis.definition = ls.getDefinition(pos.file, pos.line, pos.column) ?? null;
          }
          if (include.includes('references')) {
            analysis.references = ls.getReferences(pos.file, pos.line, pos.column);
          }
          if (include.includes('diagnostics')) {
            analysis.diagnostics = await ls.getDiagnostics(pos.file);
          }
          if (include.includes('signature')) {
            analysis.signature = ls.getSignature(pos.file, pos.line, pos.column) ?? null;
          }

          return analysis;
        })
      );

      return { results, count: results.length };
    },
  },
};
