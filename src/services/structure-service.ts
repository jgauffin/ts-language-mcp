import ts from 'typescript';
import * as path from 'path';
import { DiagnosticsService } from './diagnostics-service.js';
import type {
  SymbolInfo,
  CompletionItem,
  SignatureInfo,
  PositionAnalysis,
  ImportInfo,
  OutlineItem,
  WorkspaceSymbol,
  ModuleDependency,
  ModuleDependents,
  ModuleDependenciesResult,
} from '../types.js';

/**
 * Describes the shape of the code: what a file declares, what it imports, and
 * how modules depend on one another.
 */
export abstract class StructureService extends DiagnosticsService {
  getSymbols(filePath: string): SymbolInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    const navTree = this.service.getNavigationTree(absolutePath);
    const symbols: SymbolInfo[] = [];

    const walk = (item: ts.NavigationTree, containerName?: string): void => {
      if (item.kind !== ts.ScriptElementKind.moduleElement) {
        const pos = this.toLineColumn(absolutePath, item.spans[0]?.start ?? 0);
        symbols.push({
          name: item.text,
          kind: item.kind,
          line: pos.line,
          column: pos.column,
          containerName,
        });
      }

      if (item.childItems) {
        for (const child of item.childItems) {
          walk(child, item.text);
        }
      }
    };

    walk(navTree);
    return symbols;
  }

  getCompletions(
    filePath: string,
    line: number,
    column: number
  ): CompletionItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const completions = this.service.getCompletionsAtPosition(
      absolutePath,
      offset,
      undefined
    );

    if (!completions) return [];

    return completions.entries.slice(0, 50).map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      sortText: entry.sortText,
      insertText: entry.insertText,
    }));
  }

  getSignature(
    filePath: string,
    line: number,
    column: number
  ): SignatureInfo | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const sigHelp = this.service.getSignatureHelpItems(absolutePath, offset, {});
    if (!sigHelp || sigHelp.items.length === 0) return undefined;

    const item = sigHelp.items[0];

    return {
      label: item.prefixDisplayParts
        .concat(
          item.parameters.flatMap((p, i) =>
            i > 0
              ? [{ text: ', ', kind: 'punctuation' }, ...p.displayParts]
              : p.displayParts
          )
        )
        .concat(item.suffixDisplayParts)
        .map((p) => p.text)
        .join(''),
      documentation: item.documentation.map((d) => d.text).join(''),
      parameters: item.parameters.map((p) => ({
        label: p.displayParts.map((d) => d.text).join(''),
        documentation: p.documentation.map((d) => d.text).join(''),
      })),
      activeParameter: sigHelp.argumentIndex,
    };
  }

  /**
   * Bundles multiple analyses for a position into one call.
   * Useful for AI agents to get full context efficiently.
   */
  async analyzePosition(
    filePath: string,
    line: number,
    column: number
  ): Promise<PositionAnalysis> {
    return {
      hover: this.getHover(filePath, line, column),
      definition: this.getDefinition(filePath, line, column),
      references: this.getReferences(filePath, line, column),
      diagnostics: await this.getDiagnostics(filePath),
      signature: this.getSignature(filePath, line, column),
    };
  }

  getImports(filePath: string): ImportInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const content = this.fileManager.getFileEntry(absolutePath)?.content;
    if (!content) return [];

    const sourceFile = ts.createSourceFile(
      absolutePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const imports: ImportInfo[] = [];

    sourceFile.statements.forEach((stmt) => {
      if (ts.isImportDeclaration(stmt)) {
        const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
        const importClause = stmt.importClause;
        const { line } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());

        const info: ImportInfo = {
          moduleSpecifier,
          // A clause is marked with at most one phase keyword; only "type"
          // makes the import type-only, so a deferred import is not one.
          isTypeOnly: importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
          line: line + 1,
        };

        if (importClause) {
          if (importClause.name) {
            info.defaultImport = importClause.name.text;
          }

          if (importClause.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              info.namespaceImport = importClause.namedBindings.name.text;
            } else if (ts.isNamedImports(importClause.namedBindings)) {
              info.namedImports = importClause.namedBindings.elements.map((el) =>
                el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text
              );
            }
          }
        }

        imports.push(info);
      }
    });

    return imports;
  }

  getOutline(filePath: string): OutlineItem[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const navTree = this.service.getNavigationTree(absolutePath);

    const convertItem = (item: ts.NavigationTree): OutlineItem | null => {
      if (item.kind === ts.ScriptElementKind.moduleElement) {
        return null;
      }

      const startPos = this.toLineColumn(absolutePath, item.spans[0]?.start ?? 0);
      const endPos = this.toLineColumn(
        absolutePath,
        (item.spans[0]?.start ?? 0) + (item.spans[0]?.length ?? 0)
      );

      const outlineItem: OutlineItem = {
        name: item.text,
        kind: item.kind,
        line: startPos.line,
        column: startPos.column,
        endLine: endPos.line,
        endColumn: endPos.column,
      };

      if (item.childItems && item.childItems.length > 0) {
        outlineItem.children = item.childItems
          .map(convertItem)
          .filter((c): c is OutlineItem => c !== null);
      }

      return outlineItem;
    };

    if (navTree.kind === ts.ScriptElementKind.moduleElement && navTree.childItems) {
      return navTree.childItems
        .map(convertItem)
        .filter((c): c is OutlineItem => c !== null);
    }

    const result = convertItem(navTree);
    return result ? [result] : [];
  }

  /**
   * Resolves a module specifier through the compiler, so tsconfig "paths"
   * aliases, package entry points and extensionless imports all land on the
   * real file. Returns a project-relative path, or undefined for anything
   * outside the project.
   */
  resolveModule(specifier: string, containingFile: string): string | undefined {
    const absoluteContaining = path.resolve(this.projectRoot, containingFile);
    const resolved = ts.resolveModuleName(
      specifier,
      absoluteContaining,
      this.compilerOptions,
      ts.sys
    ).resolvedModule;

    if (!resolved || resolved.isExternalLibraryImport) return undefined;

    const relative = this.toRelative(resolved.resolvedFileName);
    return relative.startsWith('..') ? undefined : relative;
  }

  /**
   * What a file imports and what imports it.
   */
  getModuleDependencies(
    filePath: string,
    options?: {
      direction?: 'imports' | 'importedBy' | 'both';
      includeExternal?: boolean;
    }
  ): ModuleDependenciesResult {
    const direction = options?.direction ?? 'both';
    const includeExternal = options?.includeExternal ?? false;

    const imports = this.collectModuleDependencies(filePath, includeExternal);
    const importedBy = this.collectDependents(filePath);

    const internalImports = imports.filter((i) => !i.external);
    const efferent = new Set(internalImports.map((i) => i.resolvedFile ?? i.module)).size;
    const afferent = new Set(importedBy.map((d) => d.file)).size;

    return {
      file: filePath,
      ...(direction !== 'importedBy' ? { imports } : {}),
      ...(direction !== 'imports' ? { importedBy } : {}),
      metrics: {
        efferentCoupling: efferent,
        afferentCoupling: afferent,
        instability:
          efferent + afferent > 0
            ? Math.round((efferent / (efferent + afferent)) * 100) / 100
            : 0,
      },
    };
  }

  /**
   * Every module specifier in a file, including dynamic imports and require
   * calls that a statements-only scan would miss.
   */
  private collectModuleDependencies(
    filePath: string,
    includeExternal: boolean
  ): ModuleDependency[] {
    const content = this.getContentForPath(filePath);
    if (content === undefined) return [];

    const absolutePath = path.resolve(this.projectRoot, filePath);
    const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
    const found: ModuleDependency[] = [];

    const record = (specifier: string, node: ts.Node, kind: ModuleDependency['kind']): void => {
      const resolvedFile = this.resolveModule(specifier, filePath);
      const external = resolvedFile === undefined;
      if (external && !includeExternal) return;

      found.push({
        module: specifier,
        ...(resolvedFile ? { resolvedFile } : {}),
        external,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        kind,
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        record(node.moduleSpecifier.text, node, 'import');
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        record(node.moduleSpecifier.text, node, 'export');
      } else if (ts.isCallExpression(node)) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            record(arg.text, node, 'dynamic-import');
          } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            record(arg.text, node, 'require');
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return found;
  }

  /** Files that import this module, straight from the compiler. */
  private collectDependents(filePath: string): ModuleDependents[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    let references: readonly ts.ReferenceEntry[];
    try {
      references = this.service.getFileReferences(absolutePath);
    } catch {
      return [];
    }

    return references.map((ref) => {
      const pos = this.toLineColumn(ref.fileName, ref.textSpan.start);
      return {
        file: this.toRelative(ref.fileName),
        line: pos.line,
        text: this.lineText(ref.fileName, pos.line),
      };
    });
  }

  /**
   * Fuzzy symbol search. Positions point at the symbol's name, which makes
   * them directly usable as input to the position-based tools.
   *
   * @param file - Optional project-relative path to search within.
   */
  getWorkspaceSymbols(
    query: string,
    maxResults: number = 100,
    file?: string
  ): WorkspaceSymbol[] {
    const scopedTo = file ? path.resolve(this.projectRoot, file) : undefined;
    const items = this.service.getNavigateToItems(query, maxResults, scopedTo);

    // NavigateToItem spans cover the whole declaration, so they start at
    // "export" rather than the name. Callers feed these positions straight
    // back into the position tools, which only resolve on the identifier.
    const nameSpans = new Map<string, Map<number, number>>();

    return items.map(item => {
      const start = this.toNameSpanStart(item.fileName, item.textSpan.start, nameSpans);
      const pos = this.toLineColumn(item.fileName, start);
      return {
        name: item.name,
        kind: item.kind,
        file: this.toRelative(item.fileName),
        line: pos.line,
        column: pos.column,
        containerName: item.containerName || undefined,
        text: this.lineText(item.fileName, pos.line),
      };
    });
  }}
