import ts from 'typescript';
import type {
  ProjectContext,
  FunctionComplexity,
  FileComplexity,
  ComplexityAnalysisResult,
} from '../types.js';

/**
 * Analyzes cyclomatic complexity and lines of code per function and file.
 */
export class ComplexityAnalyzer {
  private context: ProjectContext;

  constructor(context: ProjectContext) {
    this.context = context;
  }

  analyzeFile(filePath: string): FileComplexity {
    const content = this.context.getFileContent(filePath);
    if (!content) {
      return { file: filePath, totalLinesOfCode: 0, blankLines: 0, commentLines: 0, functions: [], averageComplexity: 0, maxComplexity: 0 };
    }

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const loc = this.countFileLOC(content);
    const functions = this.findFunctions(sourceFile, content, filePath);

    const complexities = functions.map(f => f.cyclomaticComplexity);
    const avgComplexity = complexities.length > 0
      ? complexities.reduce((a, b) => a + b, 0) / complexities.length
      : 0;
    const maxComplexity = complexities.length > 0 ? Math.max(...complexities) : 0;

    return {
      file: filePath,
      totalLinesOfCode: loc.code,
      blankLines: loc.blank,
      commentLines: loc.comment,
      functions,
      averageComplexity: Math.round(avgComplexity * 100) / 100,
      maxComplexity,
    };
  }

  analyzeProject(options?: { topN?: number }): ComplexityAnalysisResult {
    const topN = options?.topN ?? 20;

    const fileStats: { file: string; linesOfCode: number; functionCount: number; maxComplexity: number }[] = [];
    let totalFunctions = 0;
    let totalLOC = 0;
    let complexitySum = 0;
    const allFunctions: FunctionComplexity[] = [];

    for (const filePath of this.context.getProjectFiles()) {
      const result = this.analyzeFile(filePath);

      fileStats.push({
        file: filePath,
        linesOfCode: result.totalLinesOfCode,
        functionCount: result.functions.length,
        maxComplexity: result.maxComplexity,
      });

      totalFunctions += result.functions.length;
      totalLOC += result.totalLinesOfCode;
      for (const f of result.functions) {
        complexitySum += f.cyclomaticComplexity;
        allFunctions.push(f);
      }
    }

    allFunctions.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);
    fileStats.sort((a, b) => b.linesOfCode - a.linesOfCode);

    return {
      totalFiles: fileStats.length,
      totalFunctions,
      totalLOC,
      averageComplexity: totalFunctions > 0
        ? Math.round((complexitySum / totalFunctions) * 100) / 100
        : 0,
      mostComplexFunctions: allFunctions.slice(0, topN),
      largestFiles: fileStats.slice(0, topN),
    };
  }

  private findFunctions(sourceFile: ts.SourceFile, content: string, filePath: string): FunctionComplexity[] {
    const functions: FunctionComplexity[] = [];

    const visit = (node: ts.Node): void => {
      const funcInfo = this.extractFunctionInfo(node, sourceFile, content, filePath);
      if (funcInfo) {
        functions.push(funcInfo);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  private extractFunctionInfo(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string
  ): FunctionComplexity | null {
    let name: string | undefined;
    let kind: FunctionComplexity['kind'];
    let parameterCount = 0;
    let body: ts.Node | undefined;

    if (ts.isFunctionDeclaration(node)) {
      name = node.name?.getText(sourceFile) ?? '<anonymous>';
      kind = 'function';
      parameterCount = node.parameters.length;
      body = node.body;
    } else if (ts.isMethodDeclaration(node)) {
      name = node.name.getText(sourceFile);
      kind = 'method';
      parameterCount = node.parameters.length;
      body = node.body;
    } else if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent)) {
      name = node.parent.name.getText(sourceFile);
      kind = 'arrow';
      parameterCount = node.parameters.length;
      body = node.body;
    } else if (ts.isConstructorDeclaration(node)) {
      name = 'constructor';
      kind = 'constructor';
      parameterCount = node.parameters.length;
      body = node.body;
    } else if (ts.isGetAccessorDeclaration(node)) {
      name = `get ${node.name.getText(sourceFile)}`;
      kind = 'getter';
      parameterCount = 0;
      body = node.body;
    } else if (ts.isSetAccessorDeclaration(node)) {
      name = `set ${node.name.getText(sourceFile)}`;
      kind = 'setter';
      parameterCount = node.parameters.length;
      body = node.body;
    } else {
      return null;
    }

    if (!body) return null;

    const startPos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    const line = startPos.line + 1;
    const endLine = endPos.line + 1;

    const complexity = this.computeCyclomaticComplexity(body);
    const linesOfCode = this.countFunctionLOC(content, line, endLine);

    return {
      name,
      kind,
      file: filePath,
      line,
      endLine,
      cyclomaticComplexity: complexity,
      linesOfCode,
      parameterCount,
    };
  }

  private computeCyclomaticComplexity(node: ts.Node): number {
    let complexity = 1;

    const walk = (n: ts.Node): void => {
      switch (n.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ConditionalExpression:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
          complexity++;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const op = (n as ts.BinaryExpression).operatorToken.kind;
          if (
            op === ts.SyntaxKind.AmpersandAmpersandToken ||
            op === ts.SyntaxKind.BarBarToken ||
            op === ts.SyntaxKind.QuestionQuestionToken
          ) {
            complexity++;
          }
          break;
        }
      }
      ts.forEachChild(n, walk);
    };

    walk(node);
    return complexity;
  }

  private countFileLOC(content: string): { code: number; blank: number; comment: number } {
    const lines = content.split('\n');
    let blank = 0;
    let comment = 0;
    let inBlockComment = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (inBlockComment) {
        comment++;
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }

      if (trimmed === '') {
        blank++;
      } else if (trimmed.startsWith('//')) {
        comment++;
      } else if (trimmed.startsWith('/*')) {
        comment++;
        if (!trimmed.includes('*/')) {
          inBlockComment = true;
        }
      }
    }

    return {
      code: lines.length - blank - comment,
      blank,
      comment,
    };
  }

  private countFunctionLOC(content: string, startLine: number, endLine: number): number {
    const lines = content.split('\n').slice(startLine - 1, endLine);
    let count = 0;
    let inBlockComment = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (inBlockComment) {
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }

      if (trimmed === '' || trimmed.startsWith('//')) {
        continue;
      }

      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) {
          inBlockComment = true;
        }
        continue;
      }

      count++;
    }

    return count;
  }
}
