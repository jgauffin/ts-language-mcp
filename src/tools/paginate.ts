const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

export interface Page<T> {
  page: T[];
  total: number;
  returned: number;
  offset: number;
  truncated: boolean;
}

/**
 * Caps a result list and says so.
 *
 * An uncapped list gets truncated somewhere downstream without the caller
 * knowing, which reads as "that is all there is". Reporting total alongside
 * returned makes a partial answer visibly partial.
 */
export function paginate<T>(items: T[], limit?: number, offset?: number): Page<T> {
  const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset as number)) : 0;
  const size = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit as number), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const page = items.slice(start, start + size);

  return {
    page,
    total: items.length,
    returned: page.length,
    offset: start,
    truncated: start + page.length < items.length,
  };
}

/** JSON Schema fragment for the limit/offset pair. */
export const PAGINATION_PROPS = {
  limit: {
    type: 'number',
    description: `Maximum results to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})`,
  },
  offset: {
    type: 'number',
    description: 'Number of results to skip, for paging through a large set (default: 0)',
  },
} as const;
