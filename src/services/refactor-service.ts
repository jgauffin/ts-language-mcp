import ts from 'typescript';
import * as path from 'path';
import { StructureService } from './structure-service.js';
import { toFormatSettings } from './service-base.js';
import type {
  RenameLocation,
  RenameFileChange,
  RenameResult,
  FormatOptions,
  FormatResult,
  CodeFix,
  ApplyEditsResult,
  OrganizeImportsResult,
} from '../types.js';

/**
 * Changes the code: renames, formatting, and the fixes the compiler proposes.
 * Every operation can preview before it writes, so a caller sees what an edit
 * would do before it does it.
 */
export abstract class RefactorService extends StructureService {
  /**
   * Raw rename locations straight from TypeScript.
   *
   * providePrefixAndSuffixTextForRename is what makes TypeScript report the
   * extra text a site needs; without it shorthand properties and aliased
   * imports come back as bare substitutions and get rewritten incorrectly.
   */
  private findRawRenameLocations(
    filePath: string,
    line: number,
    column: number
  ): { locations: readonly ts.RenameLocation[]; displayName: string } {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const renameInfo = this.service.getRenameInfo(absolutePath, offset, {
      providePrefixAndSuffixTextForRename: true,
    });
    if (!renameInfo.canRename) return { locations: [], displayName: '' };

    const locations = this.service.findRenameLocations(absolutePath, offset, false, false, {
      providePrefixAndSuffixTextForRename: true,
    });

    return { locations: locations ?? [], displayName: renameInfo.displayName };
  }

  getRenameLocations(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameLocation[] {
    const { locations, displayName } = this.findRawRenameLocations(filePath, line, column);

    return locations.map((loc) => {
      const pos = this.toLineColumn(loc.fileName, loc.textSpan.start);
      return {
        file: this.toRelative(loc.fileName),
        line: pos.line,
        column: pos.column,
        text: this.lineText(loc.fileName, pos.line),
        originalText: displayName,
        newText: newName,
        ...(loc.prefixText ? { prefixText: loc.prefixText } : {}),
        ...(loc.suffixText ? { suffixText: loc.suffixText } : {}),
      };
    });
  }

  applyRename(
    filePath: string,
    line: number,
    column: number,
    newName: string
  ): RenameResult {
    const { locations, displayName } = this.findRawRenameLocations(filePath, line, column);

    if (locations.length === 0) {
      return this.renameFailure(`No symbol that can be renamed at ${filePath}:${line}:${column}`);
    }

    const changesByFile = new Map<string, ts.RenameLocation[]>();
    for (const loc of locations) {
      const existing = changesByFile.get(loc.fileName) ?? [];
      existing.push(loc);
      changesByFile.set(loc.fileName, existing);
    }

    // Every file is rewritten in memory and checked before anything reaches
    // disk, so a rename that cannot be applied cleanly leaves no half-renamed
    // project behind.
    const rewritten: Array<RenameFileChange & { content: string }> = [];

    for (const [absolutePath, fileLocations] of changesByFile) {
      const relativePath = this.toRelative(absolutePath);
      const content = this.fileManager.getFileContent(relativePath);
      if (content === undefined) {
        return this.renameFailure(`${relativePath} holds occurrences but is not loaded`);
      }

      // Apply back to front so earlier spans keep their offsets. Working from
      // the compiler's own spans avoids re-deriving positions from line/column.
      const sorted = [...fileLocations].sort((a, b) => b.textSpan.start - a.textSpan.start);

      let result = content;
      for (const loc of sorted) {
        const start = loc.textSpan.start;
        const end = start + loc.textSpan.length;

        const found = content.substring(start, end);
        if (!this.spanHoldsName(found, displayName)) {
          const pos = this.toLineColumn(loc.fileName, start);
          return this.renameFailure(
            `Compiler offsets do not match the file: expected "${displayName}" at ` +
              `${relativePath}:${pos.line}:${pos.column} but found "${found}". Nothing was written.`
          );
        }

        const replacement = `${loc.prefixText ?? ''}${newName}${loc.suffixText ?? ''}`;
        result = result.substring(0, start) + replacement + result.substring(end);
      }

      rewritten.push({ file: relativePath, changes: fileLocations.length, content: result });
    }

    for (const file of rewritten) {
      this.fileManager.writeFile(file.file, file.content);
    }

    return {
      success: true,
      filesModified: rewritten.map((f) => f.file),
      totalChanges: locations.length,
      changes: rewritten.map((f) => ({ file: f.file, changes: f.changes })),
    };
  }

  private renameFailure(reason: string): RenameResult {
    return { success: false, filesModified: [], totalChanges: 0, changes: [], reason };
  }

  /**
   * Quoted member names (`{ "foo-bar": 1 }`) come back with the quotes in the
   * span but without them in the display name.
   */
  private spanHoldsName(spanText: string, displayName: string): boolean {
    if (spanText === displayName) return true;
    const unquoted = spanText.replace(/^['"`]|['"`]$/g, '');
    return unquoted === displayName;
  }

  formatDocument(
    filePath: string,
    options?: FormatOptions,
    includeContent = false
  ): FormatResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const fileEntry = this.fileManager.getFileEntry(absolutePath);

    if (!fileEntry) {
      return { formatted: false, changeCount: 0, file: filePath };
    }

    const formatOptions = toFormatSettings(options);

    const edits = this.service.getFormattingEditsForDocument(absolutePath, formatOptions);

    if (edits.length === 0) {
      return {
        formatted: true,
        changeCount: 0,
        file: filePath,
        ...(includeContent ? { content: fileEntry.content } : {}),
      };
    }

    let content = fileEntry.content;
    const sortedEdits = [...edits].sort((a, b) => b.span.start - a.span.start);

    for (const edit of sortedEdits) {
      const before = content.substring(0, edit.span.start);
      const after = content.substring(edit.span.start + edit.span.length);
      content = before + edit.newText + after;
    }

    this.fileManager.writeFile(filePath, content);

    // The formatted file is on disk, so returning its full text by default
    // would just be an expensive copy of something the agent can read.
    return {
      formatted: true,
      changeCount: edits.length,
      file: filePath,
      ...(includeContent ? { content } : {}),
    };
  }

  /**
   * Fixes TypeScript proposes for the problems at a position.
   */
  getCodeFixes(
    filePath: string,
    line: number,
    column: number,
    errorCodes?: number[]
  ): CodeFix[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const found = this.diagnosticsAt(absolutePath, offset);
    const codes = errorCodes && errorCodes.length > 0 ? errorCodes : found.codes;
    if (codes.length === 0) return [];

    const fixes = this.service.getCodeFixesAtPosition(
      absolutePath,
      found.start,
      found.end,
      codes,
      toFormatSettings(),
      {}
    );

    return fixes.map((fix) => ({
      fixName: fix.fixName,
      description: fix.description,
      ...(fix.fixAllDescription ? { fixAllDescription: fix.fixAllDescription } : {}),
      changes: this.toFileEdits(fix.changes),
    }));
  }

  /**
   * Applies one of the fixes from getCodeFixes and writes the result to disk.
   */
  applyCodeFix(
    filePath: string,
    line: number,
    column: number,
    fixName: string,
    applyToAll = false
  ): ApplyEditsResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const found = this.diagnosticsAt(absolutePath, offset);
    if (found.codes.length === 0) {
      throw new Error(
        `No diagnostics at ${filePath}:${line}:${column}, so there is nothing to fix.`
      );
    }

    const fixes = this.service.getCodeFixesAtPosition(
      absolutePath,
      found.start,
      found.end,
      found.codes,
      toFormatSettings(),
      {}
    );

    const fix = fixes.find((f) => f.fixName === fixName);
    if (!fix) {
      const available = fixes.map((f) => f.fixName);
      throw new Error(
        `No fix named "${fixName}" at ${filePath}:${line}:${column}. ` +
        (available.length > 0
          ? `Available: ${available.join(', ')}.`
          : 'No fixes are available at this position.')
      );
    }

    let changes: readonly ts.FileTextChanges[] = fix.changes;
    if (applyToAll && fix.fixId !== undefined) {
      changes = this.service.getCombinedCodeFix(
        { type: 'file', fileName: absolutePath },
        fix.fixId,
        toFormatSettings(),
        {}
      ).changes;
    }

    const { filesModified, totalEdits } = this.writeFileTextChanges(changes);
    return { applied: totalEdits > 0, filesModified, totalEdits, description: fix.description };
  }

  /**
   * Sorts and prunes a file's imports using TypeScript's own organizer.
   */
  organizeImports(filePath: string, apply = false): OrganizeImportsResult {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    const changes = this.service.organizeImports(
      { type: 'file', fileName: absolutePath },
      toFormatSettings(),
      {}
    );

    if (!apply) {
      const totalEdits = changes.reduce((sum, c) => sum + c.textChanges.length, 0);
      return {
        applied: false,
        filesModified: [],
        totalEdits,
        changes: this.toFileEdits(changes),
      };
    }

    const preview = this.toFileEdits(changes);
    const { filesModified, totalEdits } = this.writeFileTextChanges(changes);
    return { applied: totalEdits > 0, filesModified, totalEdits, changes: preview };
  }}
