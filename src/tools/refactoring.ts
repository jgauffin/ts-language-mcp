import type { FormatOptions, PositionParams } from '../types.js';
import type { ToolModule } from './context.js';
import { BY_SYMBOL_NOTE, TOOL_SCHEMAS } from './schemas.js';

/**
 * Tools that change code: renames and formatting.
 */
export const refactoringTools: ToolModule = {
  definitions: [
    {
      name: 'rename_preview',
      description:
        'Preview what locations would change when renaming a symbol. ' +
        'Shows all affected files and positions without making changes.',
      inputSchema: TOOL_SCHEMAS.renameParams,
    },
    {
      name: 'rename_symbol',
      description:
        'Rename a symbol across the project, writing the changes to disk. ' +
        'Handles shorthand properties and aliased imports correctly. ' +
        'Returns summary of files modified and total changes made.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.renameParams,
    },
    {
      name: 'format_document',
      description:
        'Format a TypeScript/JavaScript file using TypeScript\'s built-in formatter ' +
        'and write the result to disk. ' +
        'Pass includeContent to also get the formatted text back.',
      inputSchema: TOOL_SCHEMAS.formatDocumentParams,
    },
    {
      name: 'get_code_fixes',
      description:
        'Get the fixes TypeScript itself proposes for the errors at a position, ' +
        'such as adding a missing import, adding a missing member, or removing unused code. ' +
        'Prefer this over hand-writing a fix for a reported diagnostic: the compiler ' +
        'already knows the exact edit, including the correct import path.' + BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.codeFixParams,
    },
    {
      name: 'apply_code_fix',
      description:
        'Apply one of the fixes returned by get_code_fixes and write it to disk. ' +
        'Set applyToAll to fix every occurrence of the same problem in the file.' +
        BY_SYMBOL_NOTE,
      inputSchema: TOOL_SCHEMAS.applyCodeFixParams,
    },
    {
      name: 'organize_imports',
      description:
        'Sort a file\'s imports and drop unused ones, using TypeScript\'s own organizer. ' +
        'Previews the edits by default; pass apply to write them to disk.',
      inputSchema: TOOL_SCHEMAS.organizeImportsParams,
    },
  ],

  handlers: {
    rename_preview: (args, ctx) => {
      const p = args as unknown as PositionParams & { newName: string };
      const result = ctx.languageService.getRenameLocations(p.file, p.line, p.column, p.newName);
      return { locations: result, count: result.length };
    },

    rename_symbol: (args, ctx) => {
      const p = args as unknown as PositionParams & { newName: string };
      return ctx.languageService.applyRename(p.file, p.line, p.column, p.newName);
    },

    format_document: (args, ctx) => {
      const p = args as { file: string; options?: FormatOptions; includeContent?: boolean };
      return ctx.languageService.formatDocument(p.file, p.options, p.includeContent ?? false);
    },

    get_code_fixes: (args, ctx) => {
      const p = args as unknown as PositionParams & { errorCodes?: number[] };
      const fixes = ctx.languageService.getCodeFixes(p.file, p.line, p.column, p.errorCodes);
      return { fixes, count: fixes.length };
    },

    apply_code_fix: (args, ctx) => {
      const p = args as unknown as PositionParams & {
        fixName: string;
        applyToAll?: boolean;
      };
      return ctx.languageService.applyCodeFix(
        p.file,
        p.line,
        p.column,
        p.fixName,
        p.applyToAll ?? false
      );
    },

    organize_imports: (args, ctx) => {
      const p = args as { file: string; apply?: boolean };
      return ctx.languageService.organizeImports(p.file, p.apply ?? false);
    },
  },
};
