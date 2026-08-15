import type { IndirectionHotspotsParams } from '../types.js';
import type { DuplicationOptions } from '../analyzers/duplication-detector.js';
import type { ToolModule } from './context.js';
import { TOOL_SCHEMAS } from './schemas.js';

/**
 * Tools that judge the code rather than describe it: complexity,
 * coupling, duplication, and indirection.
 */
export const qualityTools: ToolModule = {
  definitions: [
    {
      name: 'calculate_metrics',
      description:
        'Calculate code quality metrics: cyclomatic complexity per function, lines of code per function/file. ' +
        'Identifies complexity hotspots. Omit "file" for project-wide analysis.',
      inputSchema: TOOL_SCHEMAS.metricsParams,
    },
    {
      name: 'find_indirection_hotspots',
      description:
        'Find symbols most heavily accessed through layers of indirection (A → B → C). ' +
        'Returns worst offenders ranked by score with full call chains. ' +
        'Useful for identifying hidden coupling and deeply wrapped dependencies.',
      inputSchema: TOOL_SCHEMAS.indirectionParams,
    },
    {
      name: 'detect_duplication',
      description:
        'Detect duplicate code blocks by comparing AST structure fingerprints. ' +
        'Matches are exact structural duplicates, ignoring identifier and literal ' +
        'values, so renamed copies are found but near-misses with an extra ' +
        'statement are not.',
      inputSchema: TOOL_SCHEMAS.duplicationParams,
    },
    {
      name: 'get_module_dependencies',
      description:
        'Show what a file imports and what imports it, resolved through the ' +
        'TypeScript compiler so tsconfig "paths" aliases and package entry points ' +
        'are handled correctly. Covers static imports, re-exports, dynamic import() ' +
        'and require(). Includes efferent/afferent coupling and instability.',
      inputSchema: TOOL_SCHEMAS.moduleDependenciesParams,
    },
    {
      name: 'quality_report',
      description:
        'Combined code quality report: worst complexity hotspots, most coupled/unstable modules, ' +
        'and duplicate code blocks — top offenders across all categories in one call.',
      inputSchema: TOOL_SCHEMAS.qualityReportParams,
    },
  ],

  handlers: {
    calculate_metrics: (args, ctx) => {
      const p = args as { file?: string; topN?: number };
      if (p.file) {
        return ctx.complexity.analyzeFile(p.file);
      }
      return ctx.complexity.analyzeProject({ topN: p.topN });
    },

    find_indirection_hotspots: (args, ctx) =>
      ctx.indirection.analyze(args as IndirectionHotspotsParams),

    detect_duplication: (args, ctx) => {
      const p = args as { file?: string; minNodes?: number; minStatements?: number };
      const options: DuplicationOptions = {
        minNodes: p.minNodes,
        minStatements: p.minStatements,
      };
      if (p.file) {
        return { groups: ctx.duplication.analyzeFile(p.file, options) };
      }
      return ctx.duplication.analyzeProject(options);
    },

    get_module_dependencies: (args, ctx) => {
      const p = args as {
        file: string;
        direction?: 'imports' | 'importedBy' | 'both';
        includeExternal?: boolean;
      };
      return ctx.languageService.getModuleDependencies(p.file, {
        direction: p.direction,
        includeExternal: p.includeExternal,
      });
    },

    quality_report: (args, ctx) => {
      const topN = (args as { topN?: number }).topN ?? 20;

      const complexity = ctx.complexity.analyzeProject({ topN });
      const coupling = ctx.coupling.analyzeProject({ topN });
      const duplication = ctx.duplication.analyzeProject();

      const issues: { file: string; line?: number; category: string; detail: string }[] = [];

      for (const f of complexity.mostComplexFunctions) {
        issues.push({
          file: f.file,
          line: f.line,
          category: 'complexity',
          detail: `${f.name} — cyclomatic complexity ${f.cyclomaticComplexity}, ${f.linesOfCode} LOC`,
        });
      }

      for (const f of coupling.mostUnstable) {
        issues.push({
          file: f.file,
          category: 'coupling',
          detail: `instability ${f.instability} (Ce=${f.efferentCoupling}, Ca=${f.afferentCoupling})`,
        });
      }

      // Previously computed and thrown away. A file many others depend on is
      // a different risk from an unstable one, and worth reporting separately.
      for (const f of coupling.mostCoupled) {
        issues.push({
          file: f.file,
          category: 'coupling-fan',
          detail:
            `${f.efferentCoupling + f.afferentCoupling} total dependencies ` +
            `(imports ${f.efferentCoupling}, imported by ${f.afferentCoupling})`,
        });
      }

      for (const g of duplication.groups) {
        const locations = g.fragments.map(f => `${f.file}:${f.startLine}`).join(', ');
        issues.push({
          file: g.fragments[0].file,
          line: g.fragments[0].startLine,
          category: 'duplication',
          detail: `${g.fragments.length} clones, ${g.fragments[0].linesOfCode} LOC each — ${locations}`,
        });
      }

      return {
        totalFiles: complexity.totalFiles,
        totalFunctions: complexity.totalFunctions,
        totalLOC: complexity.totalLOC,
        issues,
      };
    },
  },
};
