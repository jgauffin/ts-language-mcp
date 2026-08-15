import type { TypeScriptLanguageService } from './language-service.js';
import type { FilePosition, WorkspaceSymbol } from './types.js';

/** How many candidates to search before giving up on an exact match. */
const SEARCH_LIMIT = 200;

/** How many candidates to name when a lookup is ambiguous. */
const MAX_REPORTED_CANDIDATES = 10;

/**
 * Turns a symbol name into a file position.
 *
 * Agents do not know line and column numbers without reading a file first,
 * and a coordinate that drifts by one line silently answers the wrong
 * question. Naming the symbol removes that whole class of error.
 *
 * @example
 * resolver.resolve('getUser');                        // anywhere in the project
 * resolver.resolve('UserService.getUser');            // disambiguated by container
 * resolver.resolve('getUser', 'src/services/api.ts'); // scoped to one file
 */
export class SymbolResolver {
  private languageService: TypeScriptLanguageService;

  constructor(languageService: TypeScriptLanguageService) {
    this.languageService = languageService;
  }

  resolve(symbol: string, file?: string): FilePosition {
    const trimmed = symbol.trim();
    if (!trimmed) {
      throw new Error('The "symbol" parameter must not be empty.');
    }

    const { container, name } = splitQualifiedName(trimmed);
    const candidates = this.findCandidates(name, container, file);

    if (candidates.length === 0) {
      throw new Error(this.notFoundMessage(trimmed, name, file));
    }

    if (candidates.length > 1) {
      throw new Error(ambiguousMessage(trimmed, candidates));
    }

    const match = candidates[0];
    return { file: match.file, line: match.line, column: match.column };
  }

  /**
   * Exact-name matches only. The underlying search is fuzzy, so accepting its
   * near misses would reintroduce the guessing this is meant to remove.
   */
  private findCandidates(
    name: string,
    container: string | undefined,
    file?: string
  ): WorkspaceSymbol[] {
    const found = this.languageService.getWorkspaceSymbols(name, SEARCH_LIMIT, file);

    const exact = found.filter((item) => item.name === name);
    if (!container) return dedupe(exact);

    return dedupe(exact.filter((item) => item.containerName === container));
  }

  private notFoundMessage(requested: string, name: string, file?: string): string {
    const where = file ? ` in ${file}` : ' in the project';
    const near = this.languageService
      .getWorkspaceSymbols(name, MAX_REPORTED_CANDIDATES, file)
      .map((item) => describe(item));

    const hint =
      near.length > 0
        ? ` Similar symbols: ${near.join(', ')}.`
        : ' Use the "find" or "get_workspace_symbols" tool to discover symbol names.';

    return `No symbol named "${requested}" found${where}.${hint}`;
  }
}

/** Splits "Container.member" into its parts; a bare name has no container. */
function splitQualifiedName(symbol: string): { container?: string; name: string } {
  const lastDot = symbol.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === symbol.length - 1) {
    return { name: symbol };
  }
  return { container: symbol.slice(0, lastDot), name: symbol.slice(lastDot + 1) };
}

/** The same declaration can surface more than once; collapse by position. */
function dedupe(items: WorkspaceSymbol[]): WorkspaceSymbol[] {
  const seen = new Map<string, WorkspaceSymbol>();
  for (const item of items) {
    seen.set(`${item.file}:${item.line}:${item.column}`, item);
  }
  return Array.from(seen.values());
}

function describe(item: WorkspaceSymbol): string {
  const qualified = item.containerName ? `${item.containerName}.${item.name}` : item.name;
  return `${qualified} (${item.kind}) at ${item.file}:${item.line}`;
}

/**
 * Listing the candidates beats picking one. Choosing silently is how an agent
 * ends up confidently editing the wrong declaration.
 */
function ambiguousMessage(requested: string, candidates: WorkspaceSymbol[]): string {
  const shown = candidates.slice(0, MAX_REPORTED_CANDIDATES).map(describe);
  const more =
    candidates.length > shown.length ? ` (and ${candidates.length - shown.length} more)` : '';

  return (
    `"${requested}" is ambiguous: ${candidates.length} symbols match${more}. ` +
    `Candidates: ${shown.join(', ')}. ` +
    `Pass "file" to narrow the search, qualify the name as "Container.member", ` +
    `or use explicit line and column.`
  );
}
