import ts from 'typescript';
import { minimatch } from 'minimatch';
import type { TypeScriptLanguageService } from './language-service.js';
import type { FindParams, FindResult, SymbolKind } from './types.js';
import { normalizePath, pathEndsWith, pathStartsWith } from './tools.js';

/**
 * Traverses TypeScript AST to find symbols matching search criteria.
 * Provides semantic search capabilities beyond simple text matching.
 *
 * @example
 * const finder = new AstFinder(languageService);
 * const results = finder.find({
 *   query: '*Service',
 *   kinds: ['class', 'interface'],
 *   exported: true
 * });
 */
export class AstFinder {
  private languageService: TypeScriptLanguageService;

  constructor(languageService: TypeScriptLanguageService) {
    this.languageService = languageService;
  }

  /**
   * Finds symbols matching the given criteria.
   */
  find(params: FindParams): FindResult[] {
    const { query, kinds, scope = 'project', path: searchPath, exported } = params;

    const files = this.getFilesToSearch(scope, searchPath);
    const results: FindResult[] = [];

    // Check if we need to find comments (handled separately as trivia)
    const findComments = kinds?.includes('comment');
    const findOtherKinds = !kinds || kinds.length === 0 || kinds.some((k) => k !== 'comment');

    for (const filePath of files) {
      const content = this.languageService.getFileContent(filePath);
      if (!content) continue;

      // Parse file directly for AST traversal
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      // Find comments if requested
      if (findComments) {
        this.findComments(sourceFile, content, filePath, query, results);
      }

      // Find other symbols if requested
      if (findOtherKinds) {
        this.walkNode(sourceFile, sourceFile, (node, symbolKind, isExported) => {
          const name = this.getNodeName(node);
          if (!name) return;

          // Filter by kind
          if (kinds && kinds.length > 0 && !kinds.includes(symbolKind)) {
            return;
          }

          // Filter by export status
          if (exported !== undefined && isExported !== exported) {
            return;
          }

          // Filter by query pattern
          if (query && !this.matchesPattern(name, query)) {
            return;
          }

          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart()
          );

          results.push({
            name,
            kind: symbolKind,
            file: filePath,
            line: line + 1, // 1-based
            column: character + 1,
            snippet: this.getSnippet(node, sourceFile),
            exported: isExported,
          });
        });
      }
    }

    return results;
  }

  /**
   * Finds comments in a source file (comments are trivia, not AST nodes).
   */
  private findComments(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
    query: string | undefined,
    results: FindResult[]
  ): void {
    const text = sourceFile.getFullText();

    // Find single-line comments
    const singleLineRegex = /\/\/(.*)$/gm;
    let match;
    while ((match = singleLineRegex.exec(text)) !== null) {
      const commentText = match[1].trim();
      if (!query || this.matchesPattern(commentText, query)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(match.index);
        results.push({
          name: commentText.substring(0, 50) + (commentText.length > 50 ? '...' : ''),
          kind: 'comment',
          file: filePath,
          line: line + 1,
          column: character + 1,
          snippet: match[0].trim(),
          exported: false,
        });
      }
    }

    // Find multi-line comments
    const multiLineRegex = /\/\*[\s\S]*?\*\//g;
    while ((match = multiLineRegex.exec(text)) !== null) {
      const commentText = match[0].replace(/^\/\*\s*|\s*\*\/$/g, '').trim();
      if (!query || this.matchesPattern(commentText, query)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(match.index);
        results.push({
          name: commentText.substring(0, 50) + (commentText.length > 50 ? '...' : ''),
          kind: 'comment',
          file: filePath,
          line: line + 1,
          column: character + 1,
          snippet: match[0].split('\n')[0].trim(),
          exported: false,
        });
      }
    }
  }

  /**
   * Determines which files to search based on scope.
   */
  private getFilesToSearch(scope: string, searchPath?: string): string[] {
    const allFiles = this.languageService.getProjectFiles();

    switch (scope) {
      case 'file':
        if (!searchPath) return [];
        const normalizedSearchPath = normalizePath(searchPath);
        return allFiles.filter(
          (f) => f === normalizedSearchPath || pathEndsWith(f, normalizedSearchPath)
        );

      case 'directory':
        if (!searchPath) return allFiles;
        const normalizedDir = normalizePath(searchPath);
        return allFiles.filter(
          (f) => pathStartsWith(f, normalizedDir) || pathStartsWith(f, './' + normalizedDir)
        );

      case 'project':
      default:
        return allFiles;
    }
  }

  /**
   * Recursively walks AST nodes, calling visitor for declarations.
   */
  private walkNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    visitor: (node: ts.Node, kind: SymbolKind, exported: boolean) => void
  ): void {
    const symbolKind = this.getSymbolKind(node);

    if (symbolKind) {
      const isExported = this.isNodeExported(node);
      visitor(node, symbolKind, isExported);
    }

    ts.forEachChild(node, (child) => this.walkNode(child, sourceFile, visitor));
  }

  /**
   * Maps a TS node to our SymbolKind, or undefined if not a declaration.
   */
  private getSymbolKind(node: ts.Node): SymbolKind | undefined {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      return 'function';
    }
    if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent)) {
      // Arrow functions are handled via their variable declaration
      return undefined;
    }
    if (ts.isMethodDeclaration(node)) {
      return 'method';
    }
    if (ts.isClassDeclaration(node)) {
      return 'class';
    }
    if (ts.isInterfaceDeclaration(node)) {
      return 'interface';
    }
    if (ts.isTypeAliasDeclaration(node)) {
      return 'type';
    }
    if (ts.isEnumDeclaration(node)) {
      return 'enum';
    }
    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      return 'property';
    }
    if (ts.isParameter(node)) {
      return 'parameter';
    }
    if (ts.isImportDeclaration(node)) {
      return 'import';
    }
    if (ts.isImportSpecifier(node)) {
      return 'import';
    }
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      return 'export';
    }
    if (ts.isExportSpecifier(node)) {
      return 'export';
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      return 'string';
    }
    if (ts.isVariableDeclaration(node)) {
      // Check if const or let/var
      const varStatement = this.findParentVariableStatement(node);
      if (varStatement) {
        const flags = varStatement.declarationList.flags;
        if (flags & ts.NodeFlags.Const) {
          // Check if it's an arrow function
          if (node.initializer && ts.isArrowFunction(node.initializer)) {
            return 'function';
          }
          return 'const';
        }
      }
      return 'variable';
    }

    return undefined;
  }

  private findParentVariableStatement(node: ts.Node): ts.VariableStatement | undefined {
    let current = node.parent;
    while (current) {
      if (ts.isVariableStatement(current)) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  }

  /**
   * Extracts the name from a declaration node.
   */
  private getNodeName(node: ts.Node): string | undefined {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      return node.name?.getText();
    }

    if (ts.isVariableDeclaration(node)) {
      return node.name.getText();
    }

    if (ts.isPropertySignature(node)) {
      return node.name.getText();
    }

    if (ts.isParameter(node)) {
      return node.name.getText();
    }

    if (ts.isImportDeclaration(node)) {
      // Return module specifier for imports
      return node.moduleSpecifier.getText().replace(/['"]/g, '');
    }

    if (ts.isImportSpecifier(node)) {
      // Return the local binding name (e.g., "HttpClient" from `import { HttpClient } from '...'`)
      return node.name.getText();
    }

    if (ts.isExportDeclaration(node)) {
      // For re-exports like `export { Foo } from './bar'`, return named exports
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        // Handled by ExportSpecifier children
        return undefined;
      }
      // For `export * from './bar'`, return module specifier
      return node.moduleSpecifier?.getText().replace(/['"]/g, '');
    }

    if (ts.isExportSpecifier(node)) {
      // Return the exported name (e.g., "HttpClient" from `export { HttpClient }`)
      return (node.propertyName ?? node.name).getText();
    }

    if (ts.isExportAssignment(node)) {
      // `export default X` — return the expression name if it's an identifier
      if (ts.isIdentifier(node.expression)) {
        return node.expression.getText();
      }
      return 'default';
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Return string content without quotes
      return node.text;
    }

    if (ts.isTemplateExpression(node)) {
      // Return the head text for template expressions
      return node.head.text + '...';
    }

    return undefined;
  }

  /**
   * Checks if a node has export modifier or is in export statement.
   */
  private isNodeExported(node: ts.Node): boolean {
    // Check for export modifier
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      return true;
    }

    // Check variable statement parent for export
    if (ts.isVariableDeclaration(node)) {
      const statement = this.findParentVariableStatement(node);
      if (statement) {
        const stmtModifiers = ts.getModifiers(statement);
        if (stmtModifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Matches a name against a glob/regex pattern.
   */
  private matchesPattern(name: string, pattern: string): boolean {
    // Check if it's a regex pattern (starts and ends with /)
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      try {
        const regex = new RegExp(pattern.slice(1, -1), 'i');
        return regex.test(name);
      } catch {
        return false;
      }
    }

    // Use glob matching for patterns with wildcards
    if (pattern.includes('*') || pattern.includes('?')) {
      return minimatch(name, pattern, { nocase: true });
    }

    // Plain substring match
    return name.toLowerCase().includes(pattern.toLowerCase());
  }

  /**
   * Extracts a code snippet around the node (first line of declaration).
   */
  private getSnippet(node: ts.Node, sourceFile: ts.SourceFile): string {
    const start = node.getStart();
    const text = node.getText();

    // Get first line only, trimmed
    const firstLine = text.split('\n')[0].trim();

    // Limit length for readability
    const maxLength = 100;
    if (firstLine.length > maxLength) {
      return firstLine.substring(0, maxLength) + '...';
    }

    return firstLine;
  }
}
