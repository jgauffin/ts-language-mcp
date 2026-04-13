import ts from 'typescript';
import { createHash } from 'crypto';
import type {
  ProjectContext,
  DuplicateFragment,
  DuplicateGroup,
  DuplicationAnalysisResult,
} from '../types.js';

interface CandidateBlock {
  node: ts.Node;
  file: string;
  sourceFile: ts.SourceFile;
}

export interface DuplicationOptions {
  minNodes?: number;
  minStatements?: number;
}

const DEFAULT_MIN_NODES = 20;
const DEFAULT_MIN_STATEMENTS = 3;

/**
 * Detects duplicate code blocks by comparing AST structural fingerprints.
 * Layer 1 only: normalizes identifiers and literals, hashes structure.
 */
export class DuplicationDetector {
  private context: ProjectContext;

  constructor(context: ProjectContext) {
    this.context = context;
  }

  analyzeFile(filePath: string, options?: DuplicationOptions): DuplicateGroup[] {
    const content = this.context.getFileContent(filePath);
    if (!content) return [];

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const candidates = this.extractCandidates(sourceFile, filePath, options);
    return this.findDuplicates(candidates);
  }

  analyzeProject(options?: DuplicationOptions): DuplicationAnalysisResult {
    const allCandidates: CandidateBlock[] = [];

    for (const filePath of this.context.getProjectFiles()) {
      const content = this.context.getFileContent(filePath);
      if (!content) continue;

      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
      const candidates = this.extractCandidates(sourceFile, filePath, options);
      allCandidates.push(...candidates);
    }

    const allGroups = this.findDuplicates(allCandidates);
    const top = allGroups.slice(0, 20);

    const filesAffected = new Set<string>();
    let totalFragments = 0;
    let totalLines = 0;

    for (const group of allGroups) {
      for (const frag of group.fragments) {
        filesAffected.add(frag.file);
        totalFragments++;
        totalLines += frag.linesOfCode;
      }
    }

    return {
      totalGroups: allGroups.length,
      totalDuplicateFragments: totalFragments,
      totalDuplicateLines: totalLines,
      filesAffected: filesAffected.size,
      groups: top,
    };
  }

  private extractCandidates(
    sourceFile: ts.SourceFile,
    filePath: string,
    options?: DuplicationOptions
  ): CandidateBlock[] {
    const minNodes = options?.minNodes ?? DEFAULT_MIN_NODES;
    const minStatements = options?.minStatements ?? DEFAULT_MIN_STATEMENTS;
    const candidates: CandidateBlock[] = [];

    const visit = (node: ts.Node): void => {
      // Function/method bodies
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isConstructorDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node)) &&
        node.body
      ) {
        if (this.countNodes(node.body) >= minNodes) {
          candidates.push({ node: node.body, file: filePath, sourceFile });
        }
      }

      // Block statements with enough statements
      if (ts.isBlock(node) && node.statements.length >= minStatements) {
        // Skip if this is directly a function body (already captured above)
        if (!this.isDirectFunctionBody(node)) {
          if (this.countNodes(node) >= minNodes) {
            candidates.push({ node, file: filePath, sourceFile });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return candidates;
  }

  private isDirectFunctionBody(node: ts.Block): boolean {
    const parent = node.parent;
    return (
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isConstructorDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)
    );
  }

  private findDuplicates(candidates: CandidateBlock[]): DuplicateGroup[] {
    const hashMap = new Map<string, { candidate: CandidateBlock; fingerprint: string }[]>();

    for (const candidate of candidates) {
      const fingerprint = this.fingerprint(candidate.node);
      const hash = this.hashFingerprint(fingerprint);

      const existing = hashMap.get(hash) ?? [];
      existing.push({ candidate, fingerprint });
      hashMap.set(hash, existing);
    }

    const groups: DuplicateGroup[] = [];

    for (const [hash, entries] of hashMap) {
      if (entries.length < 2) continue;

      const fragments: DuplicateFragment[] = entries.map(({ candidate }) => {
        const startPos = candidate.sourceFile.getLineAndCharacterOfPosition(candidate.node.getStart(candidate.sourceFile));
        const endPos = candidate.sourceFile.getLineAndCharacterOfPosition(candidate.node.getEnd());
        const startLine = startPos.line + 1;
        const endLine = endPos.line + 1;

        const firstLine = candidate.node.getText(candidate.sourceFile).split('\n')[0].trim();
        const snippet = firstLine.length > 80 ? firstLine.substring(0, 80) + '...' : firstLine;

        return {
          file: candidate.file,
          startLine,
          endLine,
          linesOfCode: endLine - startLine + 1,
          snippet,
        };
      });

      const nodeKind = ts.SyntaxKind[entries[0].candidate.node.kind];

      groups.push({
        hash: hash.substring(0, 12),
        nodeKind,
        fragments,
        similarity: 1.0,
      });
    }

    // Sort by fragment count descending
    groups.sort((a, b) => b.fragments.length - a.fragments.length);

    return groups;
  }

  private fingerprint(node: ts.Node): string {
    const parts: string[] = [];

    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        parts.push('_ID_');
        return;
      }
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        parts.push('_STR_');
        return;
      }
      if (ts.isNumericLiteral(n)) {
        parts.push('_NUM_');
        return;
      }
      if (ts.isRegularExpressionLiteral(n)) {
        parts.push('_RE_');
        return;
      }

      const kindName = ts.SyntaxKind[n.kind];
      parts.push(kindName);

      // Preserve operator tokens for binary/prefix/postfix expressions
      if (ts.isBinaryExpression(n)) {
        parts.push(ts.SyntaxKind[n.operatorToken.kind]);
      }
      if (ts.isPrefixUnaryExpression(n)) {
        parts.push(ts.SyntaxKind[n.operator]);
      }
      if (ts.isPostfixUnaryExpression(n)) {
        parts.push(ts.SyntaxKind[n.operator]);
      }

      ts.forEachChild(n, walk);
    };

    walk(node);
    return parts.join(',');
  }

  private hashFingerprint(fingerprint: string): string {
    return createHash('sha256').update(fingerprint).digest('hex');
  }

  private countNodes(node: ts.Node): number {
    let count = 1;
    ts.forEachChild(node, (child) => {
      count += this.countNodes(child);
    });
    return count;
  }
}
