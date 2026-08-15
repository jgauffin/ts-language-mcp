// Import alias: only the imported name changes, the local alias stays put.
import { timeout as requestTimeout } from './config.js';

export const doubled = requestTimeout * 2;
