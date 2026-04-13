import type { TypeScriptLanguageService } from '../language-service.js';
import type {
  SymbolNode,
  IndirectionOffender,
  IndirectionHotspotsResult,
  IndirectionHotspotsParams,
  CallChainStep,
  OutlineItem,
} from '../types.js';

/**
 * Unique key for a symbol in the call graph.
 */
function symbolKey(file: string, line: number, column: number): string {
  return `${file}:${line}:${column}`;
}

function keyFromNode(node: SymbolNode): string {
  return symbolKey(node.file, node.line, node.column);
}

/** Symbol kinds that represent callable code. */
const CALLABLE_KINDS = new Set([
  'function',
  'method',
  'constructor',
  'getter',
  'setter',
  // TS navigation tree kinds
  'const',
  'let',
  'var',
]);

function isTestFile(file: string): boolean {
  return /[./](test|spec|__tests__)\b/i.test(file);
}

/**
 * Finds symbols most heavily accessed through layers of indirection (A → B → C).
 * Returns worst offenders ranked by score with full call chains.
 */
export class IndirectionAnalyzer {
  private ls: TypeScriptLanguageService;

  constructor(languageService: TypeScriptLanguageService) {
    this.ls = languageService;
  }

  analyze(params: IndirectionHotspotsParams = {}): IndirectionHotspotsResult {
    const {
      maxDepth = 5,
      minDirectCallers = 3,
      maxChainsPerOffender = 5,
      take = 30,
      skip = 0,
      includeTests = false,
    } = params;

    // ── Phase 1: Build Call Graph ──
    const { forward, reverse, symbols } = this.buildCallGraph(includeTests);

    const totalSymbols = symbols.size;

    // ── Phase 2: Pre-filter candidates ──
    const candidates = this.filterCandidates(symbols, forward, reverse, minDirectCallers);

    // ── Phase 3 Pass 1: Cheap BFS for counts/score ──
    const scored = this.scoreCandidates(candidates, symbols, reverse, maxDepth);

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // ── Phase 3 Pass 2: Reconstruct paths for top candidates ──
    const budget = (skip + take) * 3;
    const topCandidates = scored.slice(0, budget);

    const offenders: IndirectionOffender[] = [];
    for (const entry of topCandidates) {
      const chains = this.reconstructPaths(
        entry.key,
        symbols,
        reverse,
        maxDepth,
        maxChainsPerOffender,
      );

      offenders.push({
        symbol: entry.symbol,
        score: entry.score,
        directCallers: entry.directCallers,
        indirectCallers: entry.indirectCallers,
        maxChainDepth: entry.maxChainDepth,
        avgChainDepth: entry.avgChainDepth,
        worstChains: chains,
      });
    }

    // ── Phase 4: Paginate ──
    const paginated = offenders.slice(skip, skip + take);

    return {
      totalSymbols,
      candidates: candidates.length,
      offenders: paginated,
      skip,
      take,
    };
  }

  /**
   * Phase 1: Walk every file, collect callable symbols, build forward/reverse adjacency maps.
   */
  private buildCallGraph(includeTests: boolean): {
    forward: Map<string, Set<string>>;
    reverse: Map<string, Set<string>>;
    symbols: Map<string, SymbolNode>;
  } {
    const forward = new Map<string, Set<string>>();
    const reverse = new Map<string, Set<string>>();
    const symbols = new Map<string, SymbolNode>();

    const files = this.ls.getProjectFiles();

    // Step 1: Collect all callable symbols
    for (const file of files) {
      if (!includeTests && isTestFile(file)) continue;

      const outline = this.ls.getOutline(file);
      this.collectSymbols(outline, file, undefined, symbols);
    }

    // Step 2: For each symbol, get outgoing calls to build edges
    for (const [key, sym] of symbols) {
      const outgoing = this.ls.getCallHierarchy(
        sym.file,
        sym.line,
        sym.column,
        'outgoing',
      );

      for (const call of outgoing) {
        if (!call.to) continue;

        const calleeKey = symbolKey(call.to.file, call.to.line, call.to.column);

        // Skip self-calls
        if (calleeKey === key) continue;
        // Skip calls to symbols outside the project
        if (!symbols.has(calleeKey)) continue;

        // Forward edge: caller → callee
        let fwd = forward.get(key);
        if (!fwd) {
          fwd = new Set();
          forward.set(key, fwd);
        }
        fwd.add(calleeKey);

        // Reverse edge: callee → caller
        let rev = reverse.get(calleeKey);
        if (!rev) {
          rev = new Set();
          reverse.set(calleeKey, rev);
        }
        rev.add(key);
      }
    }

    return { forward, reverse, symbols };
  }

  /**
   * Recursively collect callable symbols from outline items.
   */
  private collectSymbols(
    items: OutlineItem[],
    file: string,
    containerName: string | undefined,
    symbols: Map<string, SymbolNode>,
  ): void {
    for (const item of items) {
      if (CALLABLE_KINDS.has(item.kind)) {
        const key = symbolKey(file, item.line, item.column);
        symbols.set(key, {
          name: containerName ? `${containerName}.${item.name}` : item.name,
          kind: item.kind,
          file,
          line: item.line,
          column: item.column,
          containerName,
        });
      }

      if (item.children) {
        this.collectSymbols(item.children, file, item.name, symbols);
      }
    }
  }

  /**
   * Phase 2: Keep symbols with ≥ minDirectCallers callers, rank by ratio.
   */
  private filterCandidates(
    symbols: Map<string, SymbolNode>,
    forward: Map<string, Set<string>>,
    reverse: Map<string, Set<string>>,
    minDirectCallers: number,
  ): { key: string; ratio: number }[] {
    const candidates: { key: string; ratio: number }[] = [];

    for (const key of symbols.keys()) {
      const inDegree = reverse.get(key)?.size ?? 0;
      if (inDegree < minDirectCallers) continue;

      const outDegree = forward.get(key)?.size ?? 0;
      const ratio = inDegree / Math.max(outDegree, 1);
      candidates.push({ key, ratio });
    }

    // Sort by ratio descending, keep top 500
    candidates.sort((a, b) => b.ratio - a.ratio);
    return candidates.slice(0, 500);
  }

  /**
   * Phase 3 Pass 1: BFS upward through reverse graph to count direct/indirect callers.
   */
  private scoreCandidates(
    candidates: { key: string; ratio: number }[],
    symbols: Map<string, SymbolNode>,
    reverse: Map<string, Set<string>>,
    maxDepth: number,
  ): Array<{
    key: string;
    symbol: SymbolNode;
    score: number;
    directCallers: number;
    indirectCallers: number;
    maxChainDepth: number;
    avgChainDepth: number;
  }> {
    const results: Array<{
      key: string;
      symbol: SymbolNode;
      score: number;
      directCallers: number;
      indirectCallers: number;
      maxChainDepth: number;
      avgChainDepth: number;
    }> = [];

    for (const { key } of candidates) {
      const sym = symbols.get(key)!;

      // BFS upward
      const visited = new Set<string>();
      visited.add(key);
      let directCallers = 0;
      let indirectCallers = 0;
      let maxChainDepth = 0;
      let depthSum = 0;
      let totalCallers = 0;

      // BFS queue: [symbolKey, depth]
      const queue: [string, number][] = [];

      // Seed with direct callers (depth 1)
      const directSet = reverse.get(key);
      if (directSet) {
        for (const caller of directSet) {
          if (!visited.has(caller)) {
            visited.add(caller);
            queue.push([caller, 1]);
          }
        }
      }

      while (queue.length > 0) {
        const [current, depth] = queue.shift()!;

        if (depth === 1) {
          directCallers++;
        } else {
          indirectCallers++;
        }
        totalCallers++;
        depthSum += depth;
        if (depth > maxChainDepth) maxChainDepth = depth;

        // Continue BFS if under max depth
        if (depth < maxDepth) {
          const callers = reverse.get(current);
          if (callers) {
            for (const caller of callers) {
              if (!visited.has(caller)) {
                visited.add(caller);
                queue.push([caller, depth + 1]);
              }
            }
          }
        }
      }

      // Discard if no indirect callers
      if (indirectCallers === 0) continue;

      const avgChainDepth = totalCallers > 0 ? depthSum / totalCallers : 0;
      const score = Math.round(
        (indirectCallers * 2) + (maxChainDepth * 3) + (avgChainDepth * 1.5)
      );

      results.push({
        key,
        symbol: sym,
        score,
        directCallers,
        indirectCallers,
        maxChainDepth,
        avgChainDepth: Math.round(avgChainDepth * 100) / 100,
      });
    }

    return results;
  }

  /**
   * Phase 3 Pass 2: BFS with full path tracking for top candidates.
   * Returns the N longest chains, reversed to read entry-point → ... → target.
   */
  private reconstructPaths(
    targetKey: string,
    symbols: Map<string, SymbolNode>,
    reverse: Map<string, Set<string>>,
    maxDepth: number,
    maxChains: number,
  ): CallChainStep[][] {
    const allPaths: CallChainStep[][] = [];

    // BFS with path tracking: [currentKey, path-so-far]
    const queue: [string, string[]][] = [];
    const visited = new Set<string>();
    visited.add(targetKey);

    const directCallers = reverse.get(targetKey);
    if (!directCallers) return [];

    for (const caller of directCallers) {
      if (!visited.has(caller)) {
        queue.push([caller, [targetKey, caller]]);
      }
    }

    // Track visited per-path to avoid exponential blowup but allow shared nodes across paths
    const globalVisited = new Set<string>();
    globalVisited.add(targetKey);

    while (queue.length > 0 && allPaths.length < maxChains * 10) {
      const [current, pathSoFar] = queue.shift()!;
      const depth = pathSoFar.length - 1; // exclude target itself

      // Only keep paths with depth ≥ 2 (at least one intermediary)
      if (depth >= 2) {
        const chain = pathSoFar.map((k) => {
          const s = symbols.get(k);
          return s
            ? { name: s.name, file: s.file, line: s.line }
            : { name: k, file: '', line: 0 };
        });
        // Reverse: entry-point → ... → target
        allPaths.push(chain.reverse());
      }

      // Continue BFS if under max depth
      if (depth < maxDepth) {
        const callers = reverse.get(current);
        if (callers) {
          for (const caller of callers) {
            if (!pathSoFar.includes(caller)) {
              queue.push([caller, [...pathSoFar, caller]]);
            }
          }
        }
      }
    }

    // Sort by length descending, keep top N
    allPaths.sort((a, b) => b.length - a.length);
    return allPaths.slice(0, maxChains);
  }
}
