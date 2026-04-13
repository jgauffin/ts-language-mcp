import ts from 'typescript';
import * as path from 'path';
import type {
  ProjectContext,
  FileCouplingMetrics,
  CouplingAnalysisResult,
} from '../types.js';

/**
 * Analyzes efferent/afferent coupling and instability per file.
 */
export class CouplingAnalyzer {
  private context: ProjectContext;

  constructor(context: ProjectContext) {
    this.context = context;
  }

  analyzeFile(filePath: string): FileCouplingMetrics {
    const { efferent, afferent } = this.buildGraphs();
    return this.buildMetrics(filePath, efferent, afferent);
  }

  analyzeProject(options?: { includeExternal?: boolean; topN?: number }): CouplingAnalysisResult {
    const topN = options?.topN ?? 10;
    const includeExternal = options?.includeExternal ?? false;
    const { efferent, afferent } = this.buildGraphs(includeExternal);

    const all: FileCouplingMetrics[] = [];

    for (const filePath of this.context.getProjectFiles()) {
      const metrics = this.buildMetrics(filePath, efferent, afferent);
      all.push(metrics);
    }

    const withCoupling = all.filter(f => f.efferentCoupling > 0 || f.afferentCoupling > 0);

    const avgInstability = withCoupling.length > 0
      ? withCoupling.reduce((sum, f) => sum + f.instability, 0) / withCoupling.length
      : 0;

    const mostUnstable = [...withCoupling]
      .sort((a, b) => b.instability - a.instability)
      .slice(0, topN);

    const mostCoupled = [...all]
      .sort((a, b) => (b.efferentCoupling + b.afferentCoupling) - (a.efferentCoupling + a.afferentCoupling))
      .slice(0, topN);

    return {
      totalFiles: all.length,
      averageInstability: Math.round(avgInstability * 100) / 100,
      mostUnstable,
      mostCoupled,
    };
  }

  private buildMetrics(
    filePath: string,
    efferent: Map<string, string[]>,
    afferent: Map<string, string[]>
  ): FileCouplingMetrics {
    const efferentModules = efferent.get(filePath) ?? [];
    const afferentModules = afferent.get(filePath) ?? [];
    const ce = efferentModules.length;
    const ca = afferentModules.length;
    const instability = ce + ca > 0 ? Math.round((ce / (ca + ce)) * 100) / 100 : 0;

    return {
      file: filePath,
      efferentCoupling: ce,
      afferentCoupling: ca,
      instability,
      efferentModules,
      afferentModules,
    };
  }

  private buildGraphs(includeExternal = false): {
    efferent: Map<string, string[]>;
    afferent: Map<string, string[]>;
  } {
    const projectFiles = this.context.getProjectFiles();
    const projectRoot = this.context.getProjectRoot();

    // Build a set of project files for quick lookup (normalized, without extension)
    const projectFileSet = new Set(projectFiles);
    const projectFileStemsMap = new Map<string, string>();
    for (const f of projectFiles) {
      // Strip extension for resolution
      const stem = f.replace(/\.(ts|tsx|js|jsx)$/, '');
      projectFileStemsMap.set(stem, f);
      // Also map index files: "src/utils" -> "src/utils/index.ts"
      if (f.endsWith('/index.ts') || f.endsWith('/index.tsx') || f.endsWith('/index.js') || f.endsWith('/index.jsx')) {
        const dir = path.dirname(f);
        projectFileStemsMap.set(dir, f);
      }
    }

    const efferent = new Map<string, string[]>();
    const afferent = new Map<string, string[]>();

    for (const filePath of projectFiles) {
      const content = this.context.getFileContent(filePath);
      if (!content) continue;

      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
      const imports = this.extractImports(sourceFile);
      const resolvedDeps: string[] = [];

      for (const specifier of imports) {
        if (specifier.startsWith('.')) {
          // Relative import — resolve against file's directory
          const fileDir = path.dirname(filePath);
          const resolved = path.posix.normalize(path.posix.join(fileDir, specifier));
          const target = this.resolveToProjectFile(resolved, projectFileSet, projectFileStemsMap);
          if (target && target !== filePath) {
            resolvedDeps.push(target);
          }
        } else if (includeExternal) {
          resolvedDeps.push(specifier);
        }
      }

      // Deduplicate
      const uniqueDeps = [...new Set(resolvedDeps)];
      efferent.set(filePath, uniqueDeps);

      // Build afferent (reverse) edges
      for (const dep of uniqueDeps) {
        const existing = afferent.get(dep) ?? [];
        existing.push(filePath);
        afferent.set(dep, existing);
      }
    }

    // Deduplicate afferent
    for (const [key, value] of afferent) {
      afferent.set(key, [...new Set(value)]);
    }

    return { efferent, afferent };
  }

  private extractImports(sourceFile: ts.SourceFile): string[] {
    const imports: string[] = [];

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt)) {
        const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
        imports.push(specifier);
      }
      // Also catch dynamic imports and re-exports
      if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
        const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
        imports.push(specifier);
      }
    }

    return imports;
  }

  private resolveToProjectFile(
    resolved: string,
    projectFileSet: Set<string>,
    projectFileStemsMap: Map<string, string>
  ): string | undefined {
    // Direct match (with extension already)
    if (projectFileSet.has(resolved)) return resolved;

    // Try stem match (resolved path without extension -> actual file)
    const stemMatch = projectFileStemsMap.get(resolved);
    if (stemMatch) return stemMatch;

    // Try stripping .js extension (TS imports sometimes use .js for ESM)
    const withoutJs = resolved.replace(/\.js$/, '');
    const jsMatch = projectFileStemsMap.get(withoutJs);
    if (jsMatch) return jsMatch;

    return undefined;
  }
}
