import ts from 'typescript';
import * as path from 'path';
import { normalizePath } from '../paths.js';
import { LanguageServiceBase } from './service-base.js';
import type {
  FilePosition,
  ReferenceInfo,
  ReferenceKind,
  CallHierarchyCall,
  TypeHierarchyItem,
} from '../types.js';

/**
 * Answers "what is this, and where else does it appear" — the questions asked
 * of a symbol at a position.
 */
export abstract class NavigationService extends LanguageServiceBase {
  getHover(filePath: string, line: number, column: number): string | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const quickInfo = this.service.getQuickInfoAtPosition(absolutePath, offset);
    if (!quickInfo) return undefined;

    const displayParts = quickInfo.displayParts ?? [];
    const documentation = quickInfo.documentation ?? [];

    const typeInfo = displayParts.map((p) => p.text).join('');
    const docs = documentation.map((d) => d.text).join('\n');

    return docs ? `${typeInfo}\n\n${docs}` : typeInfo;
  }

  /**
   * All declarations of the symbol at a position.
   *
   * Returning every one matters for overloads, merged declarations, and
   * `declare` plus implementation pairs, where the first hit is often not
   * the one the caller wants.
   */
  getDefinitions(filePath: string, line: number, column: number): FilePosition[] {
    return this.positionsFrom(filePath, line, column, (file, offset) =>
      this.service.getDefinitionAtPosition(file, offset)
    );
  }

  getDefinition(
    filePath: string,
    line: number,
    column: number
  ): FilePosition | undefined {
    return this.getDefinitions(filePath, line, column)[0];
  }

  /**
   * Jumps to the declaration of a symbol's type rather than of the symbol.
   */
  getTypeDefinition(filePath: string, line: number, column: number): FilePosition[] {
    return this.positionsFrom(filePath, line, column, (file, offset) =>
      this.service.getTypeDefinitionAtPosition(file, offset)
    );
  }

  getImplementations(filePath: string, line: number, column: number): FilePosition[] {
    return this.positionsFrom(filePath, line, column, (file, offset) =>
      this.service.getImplementationAtPosition(file, offset)
    );
  }

  /**
   * Runs one of the compiler's position lookups and reports the spans it
   * returns as file positions. Definitions, type definitions and
   * implementations differ only in which lookup they ask for.
   */
  private positionsFrom(
    filePath: string,
    line: number,
    column: number,
    lookup: (
      absolutePath: string,
      offset: number
    ) => readonly ts.DocumentSpan[] | undefined
  ): FilePosition[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const spans = lookup(absolutePath, offset);
    if (!spans) return [];

    return spans.map((span) => {
      const pos = this.toLineColumn(span.fileName, span.textSpan.start);
      return {
        file: this.toRelative(span.fileName),
        line: pos.line,
        column: pos.column,
        text: this.lineText(span.fileName, pos.line),
      };
    });
  }

  getReferences(
    filePath: string,
    line: number,
    column: number,
    contextLines = 0
  ): ReferenceInfo[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    // findReferences groups by symbol and marks which entries are declarations.
    // getReferencesAtPosition returns plain ReferenceEntry values, which carry
    // no isDefinition flag, so the documented "definition" kind never appeared.
    const referencedSymbols = this.service.findReferences(absolutePath, offset);
    if (!referencedSymbols) return [];

    const results: ReferenceInfo[] = [];
    for (const symbol of referencedSymbols) {
      for (const ref of symbol.references) {
        const pos = this.toLineColumn(ref.fileName, ref.textSpan.start);
        const isDefinition = ref.isDefinition ?? false;

        let kind: ReferenceKind = 'read';
        if (isDefinition) {
          kind = 'definition';
        } else if (ref.isWriteAccess) {
          kind = 'write';
        }

        results.push({
          file: this.toRelative(ref.fileName),
          line: pos.line,
          column: pos.column,
          kind,
          isDefinition,
          text: this.lineText(ref.fileName, pos.line),
          ...(contextLines > 0
            ? { context: this.surroundingLines(ref.fileName, pos.line, contextLines) }
            : {}),
        });
      }
    }

    return results;
  }

  getCallHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'incoming' | 'outgoing'
  ): CallHierarchyCall[] {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const preparedItems = this.service.prepareCallHierarchy(absolutePath, offset);
    if (!preparedItems) return [];

    const items = Array.isArray(preparedItems) ? preparedItems : [preparedItems];
    if (items.length === 0) return [];
    const results: CallHierarchyCall[] = [];

    if (direction === 'incoming') {
      const incoming = this.service.provideCallHierarchyIncomingCalls(absolutePath, offset);
      for (const call of incoming) {
        const fromPos = this.toLineColumn(call.from.file, call.from.selectionSpan.start);
        const fromEndPos = this.toLineColumn(
          call.from.file,
          call.from.span.start
        );
        results.push({
          from: {
            name: call.from.name,
            kind: call.from.kind,
            file: this.toRelative(call.from.file),
            line: fromEndPos.line,
            column: fromEndPos.column,
            selectionLine: fromPos.line,
            selectionColumn: fromPos.column,
            text: this.lineText(call.from.file, fromPos.line),
          },
          fromRanges: call.fromSpans.map((span) => {
            const pos = this.toLineColumn(call.from.file, span.start);
            return { line: pos.line, column: pos.column };
          }),
        });
      }
    } else {
      const outgoing = this.service.provideCallHierarchyOutgoingCalls(absolutePath, offset);
      for (const call of outgoing) {
        const toPos = this.toLineColumn(call.to.file, call.to.selectionSpan.start);
        const toEndPos = this.toLineColumn(call.to.file, call.to.span.start);
        results.push({
          to: {
            name: call.to.name,
            kind: call.to.kind,
            file: this.toRelative(call.to.file),
            line: toEndPos.line,
            column: toEndPos.column,
            selectionLine: toPos.line,
            selectionColumn: toPos.column,
            text: this.lineText(call.to.file, toPos.line),
          },
          fromRanges: call.fromSpans.map((span) => {
            const pos = this.toLineColumn(absolutePath, span.start);
            return { line: pos.line, column: pos.column };
          }),
        });
      }
    }

    return results;
  }

  getTypeHierarchy(
    filePath: string,
    line: number,
    column: number,
    direction: 'supertypes' | 'subtypes'
  ): TypeHierarchyItem[] {
    const program = this.service.getProgram();
    if (!program) return [];

    const declaration = this.declarationAt(program, filePath, line, column);
    if (!declaration?.name) return [];

    const checker = program.getTypeChecker();

    return direction === 'supertypes'
      ? this.supertypesOf(declaration, checker)
      : this.subtypesOf(declaration, checker, program);
  }

  /** The class or interface declaration a position sits inside, if any. */
  private declarationAt(
    program: ts.Program,
    filePath: string,
    line: number,
    column: number
  ): ts.ClassDeclaration | ts.InterfaceDeclaration | undefined {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    const offset = this.toOffset(filePath, line, column);

    const sourceFile = program.getSourceFile(absolutePath);
    if (!sourceFile) return undefined;

    const findNode = (node: ts.Node): ts.Node | undefined => {
      if (offset >= node.getStart() && offset < node.getEnd()) {
        const child = ts.forEachChild(node, findNode);
        return child || node;
      }
      return undefined;
    };

    let current: ts.Node | undefined = findNode(sourceFile);
    while (current) {
      if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) {
        return current;
      }
      current = current.parent;
    }

    return undefined;
  }

  /** What the declaration extends or implements. */
  private supertypesOf(
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
    checker: ts.TypeChecker
  ): TypeHierarchyItem[] {
    const results: TypeHierarchyItem[] = [];

    for (const clause of declaration.heritageClauses ?? []) {
      for (const typeNode of clause.types) {
        const symbol = this.resolveHeritageSymbol(checker, typeNode.expression);
        const decl = symbol?.getDeclarations()?.[0];
        if (!decl) continue;

        results.push(this.toTypeHierarchyItem(decl, symbol.getName()));
      }
    }

    return results;
  }

  /**
   * Everything in the project that extends or implements the declaration.
   *
   * Matching compares against the target's own declaration rather than its
   * name, so an unrelated type that happens to share the name is not a match.
   */
  private subtypesOf(
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
    checker: ts.TypeChecker,
    program: ts.Program
  ): TypeHierarchyItem[] {
    const targetSymbol = declaration.name
      ? checker.getSymbolAtLocation(declaration.name)
      : undefined;
    const targetDeclarations = new Set<ts.Node>(
      targetSymbol?.getDeclarations() ?? [declaration]
    );

    const projectFiles = new Set(
      this.fileManager.getAbsolutePaths().map((p) => normalizePath(p))
    );

    const results: TypeHierarchyItem[] = [];

    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      if (!projectFiles.has(normalizePath(sourceFile.fileName))) continue;

      const findSubtypes = (node: ts.Node): void => {
        if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
          for (const clause of node.heritageClauses ?? []) {
            for (const typeNode of clause.types) {
              const symbol = this.resolveHeritageSymbol(checker, typeNode.expression);
              const matches = symbol
                ?.getDeclarations()
                ?.some((d) => targetDeclarations.has(d));
              if (matches) {
                results.push(this.toTypeHierarchyItem(node, node.name.text));
              }
            }
          }
        }
        ts.forEachChild(node, findSubtypes);
      };

      findSubtypes(sourceFile);
    }

    return results;
  }

  /**
   * Resolves the symbol behind a heritage clause expression, following import
   * aliases so `import type { Shape }` resolves to the original declaration.
   */
  private resolveHeritageSymbol(
    checker: ts.TypeChecker,
    expression: ts.Expression
  ): ts.Symbol | undefined {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol ?? checker.getTypeAtLocation(expression).getSymbol();
  }

  /**
   * Builds a hierarchy item from a declaration, using that declaration's own
   * source file for the line map. Borrowing another file's line map is what
   * previously produced positions pointing at unrelated lines.
   */
  private toTypeHierarchyItem(declaration: ts.Node, name: string): TypeHierarchyItem {
    const declSourceFile = declaration.getSourceFile();
    const target =
      (declaration as ts.ClassDeclaration | ts.InterfaceDeclaration).name ?? declaration;
    const pos = declSourceFile.getLineAndCharacterOfPosition(target.getStart());

    return {
      name,
      kind: ts.isClassDeclaration(declaration) ? 'class' : 'interface',
      file: this.toRelative(declSourceFile.fileName),
      line: pos.line + 1,
      column: pos.character + 1,
      text: this.lineText(declSourceFile.fileName, pos.line + 1),
    };
  }
}
