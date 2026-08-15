/// <reference types="vitest" />
import * as path from 'path';
import YAML from 'yaml';
import { TypeScriptLanguageService } from '../src/language-service.js';
import { AstFinder } from '../src/ast-finder.js';
import { ToolHandler } from '../src/tools/index.js';
import { ComplexityAnalyzer } from '../src/analyzers/complexity-analyzer.js';
import { CouplingAnalyzer } from '../src/analyzers/coupling-analyzer.js';
import { DuplicationDetector } from '../src/analyzers/duplication-detector.js';

const SAMPLE = path.join(__dirname, 'fixtures', 'sample-project');
const DEPS = path.join(__dirname, 'fixtures', 'deps-project');

function parse<T>(text: string): T {
  return YAML.parse(text) as T;
}

describe('ComplexityAnalyzer', () => {
  let analyzer: ComplexityAnalyzer;

  beforeAll(() => {
    analyzer = new ComplexityAnalyzer(new TypeScriptLanguageService(SAMPLE));
  });

  it('counts a branch-free function as complexity 1', () => {
    const result = analyzer.analyzeFile('src/http-client.ts');
    const get = result.functions.find((f) => f.name === 'get');

    expect(get).toBeDefined();
    expect(get!.cyclomaticComplexity).toBe(1);
  });

  it('adds one decision point per branch', () => {
    const result = analyzer.analyzeFile('src/services/user-service.ts');
    const getUser = result.functions.find((f) => f.name === 'getUser');

    // getUser has a single `if`, so 1 + 1.
    expect(getUser!.cyclomaticComplexity).toBe(2);
  });

  it('records parameter counts and line spans', () => {
    const result = analyzer.analyzeFile('src/services/user-service.ts');
    const createUser = result.functions.find((f) => f.name === 'createUser');

    expect(createUser!.parameterCount).toBe(1);
    expect(createUser!.endLine).toBeGreaterThan(createUser!.line);
  });

  it('separates code, blank and comment lines', () => {
    const result = analyzer.analyzeFile('src/http-client.ts');

    expect(result.totalLinesOfCode).toBeGreaterThan(0);
    expect(result.commentLines).toBeGreaterThan(0);
    expect(result.blankLines).toBeGreaterThan(0);
  });

  it('ranks the most complex functions first across the project', () => {
    const result = analyzer.analyzeProject({ topN: 5 });

    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.mostComplexFunctions.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < result.mostComplexFunctions.length; i++) {
      expect(result.mostComplexFunctions[i - 1].cyclomaticComplexity).toBeGreaterThanOrEqual(
        result.mostComplexFunctions[i].cyclomaticComplexity
      );
    }
  });

  it('returns an empty analysis for a file it cannot read', () => {
    const result = analyzer.analyzeFile('src/does-not-exist.ts');

    expect(result.functions).toEqual([]);
    expect(result.totalLinesOfCode).toBe(0);
  });
});

describe('CouplingAnalyzer', () => {
  it('counts what a file imports and what imports it', () => {
    const analyzer = new CouplingAnalyzer(new TypeScriptLanguageService(SAMPLE));
    const metrics = analyzer.analyzeFile('src/services/user-service.ts');

    // handlers.ts imports it; it imports nothing itself.
    expect(metrics.afferentCoupling).toBeGreaterThan(0);
    expect(metrics.efferentCoupling).toBe(0);
    expect(metrics.instability).toBe(0);
  });

  it('treats a file that only imports as fully unstable', () => {
    const analyzer = new CouplingAnalyzer(new TypeScriptLanguageService(SAMPLE));
    const metrics = analyzer.analyzeFile('src/handlers.ts');

    expect(metrics.efferentCoupling).toBeGreaterThan(0);
    expect(metrics.instability).toBe(1);
  });

  it('resolves imports written through a tsconfig paths alias', () => {
    // Plain path matching cannot follow "@core/*"; compiler resolution can.
    const analyzer = new CouplingAnalyzer(new TypeScriptLanguageService(DEPS));
    const metrics = analyzer.analyzeFile('src/core/logger.ts');

    expect(metrics.afferentCoupling).toBe(2);
    expect(metrics.afferentModules).toContain('src/aliased-consumer.ts');
  });

  it('ranks the most coupled files across the project', () => {
    const analyzer = new CouplingAnalyzer(new TypeScriptLanguageService(SAMPLE));
    const result = analyzer.analyzeProject({ topN: 3 });

    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.mostCoupled.length).toBeLessThanOrEqual(3);
    expect(result.mostUnstable.length).toBeLessThanOrEqual(3);
  });
});

describe('DuplicationDetector', () => {
  it('groups two structurally identical bodies that differ only in names', () => {
    const detector = new DuplicationDetector(new TypeScriptLanguageService(SAMPLE));
    // DefaultHttpClient.get and .post share a body shape.
    const groups = detector.analyzeFile('src/http-client.ts', {
      minNodes: 1,
      minStatements: 1,
    });

    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].fragments.length).toBeGreaterThanOrEqual(2);
  });

  it('reports every fragment with a location and a snippet', () => {
    const detector = new DuplicationDetector(new TypeScriptLanguageService(SAMPLE));
    const groups = detector.analyzeFile('src/http-client.ts', {
      minNodes: 1,
      minStatements: 1,
    });

    for (const fragment of groups[0].fragments) {
      expect(fragment.file).toBeTruthy();
      expect(fragment.endLine).toBeGreaterThanOrEqual(fragment.startLine);
      expect(typeof fragment.snippet).toBe('string');
    }
  });

  it('finds nothing when the threshold excludes every block', () => {
    const detector = new DuplicationDetector(new TypeScriptLanguageService(SAMPLE));
    const groups = detector.analyzeFile('src/http-client.ts', { minStatements: 100 });

    expect(groups).toEqual([]);
  });

  it('summarises duplication across the project', () => {
    const detector = new DuplicationDetector(new TypeScriptLanguageService(SAMPLE));
    const result = detector.analyzeProject({ minNodes: 1, minStatements: 1 });

    expect(result.totalGroups).toBeGreaterThanOrEqual(result.groups.length);
    expect(result.filesAffected).toBeGreaterThan(0);
  });
});

describe('quality tools through the handler', () => {
  let handler: ToolHandler;

  beforeAll(() => {
    const service = new TypeScriptLanguageService(SAMPLE);
    handler = new ToolHandler(service, new AstFinder(service));
  });

  it('reports metrics for the whole project', async () => {
    const result = await handler.handleTool('calculate_metrics', { topN: 3 });

    expect(result.isError).toBeUndefined();
    const parsed = parse<{ totalFiles: number; mostComplexFunctions: unknown[] }>(
      result.content[0].text
    );
    expect(parsed.totalFiles).toBeGreaterThan(0);
    expect(parsed.mostComplexFunctions.length).toBeLessThanOrEqual(3);
  });

  it('produces a quality report covering every category', async () => {
    const result = await handler.handleTool('quality_report', { topN: 5 });

    expect(result.isError).toBeUndefined();
    const parsed = parse<{ issues: Array<{ category: string }> }>(result.content[0].text);
    const categories = new Set(parsed.issues.map((i) => i.category));

    expect(categories.has('complexity')).toBe(true);
    expect(categories.has('coupling')).toBe(true);
    // Previously computed and discarded rather than reported.
    expect(categories.has('coupling-fan')).toBe(true);
  });

  it('runs indirection analysis without failing', async () => {
    const result = await handler.handleTool('find_indirection_hotspots', { take: 3 });

    expect(result.isError).toBeUndefined();
    const parsed = parse<{ offenders: unknown[]; totalSymbols: number }>(
      result.content[0].text
    );
    expect(Array.isArray(parsed.offenders)).toBe(true);
    expect(parsed.totalSymbols).toBeGreaterThan(0);
  });

  it('serializes nested call chains as valid YAML', async () => {
    const result = await handler.handleTool('find_indirection_hotspots', {
      take: 3,
      minDirectCallers: 1,
    });

    // worstChains is an array of arrays, which the serializer used to mangle.
    const parsed = parse<{ offenders: Array<{ worstChains: unknown[][] }> }>(
      result.content[0].text
    );
    for (const offender of parsed.offenders) {
      expect(Array.isArray(offender.worstChains)).toBe(true);
      for (const chain of offender.worstChains) {
        expect(Array.isArray(chain)).toBe(true);
      }
    }
  });
});
