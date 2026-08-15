/// <reference types="vitest" />
import YAML from 'yaml';
import { toYaml } from '../src/yaml.js';

/**
 * Every tool response except format_document and get_completions is serialized
 * by src/yaml.ts. These tests pin the contract that matters to an MCP client:
 * whatever we emit must parse back to the values we put in.
 */
function roundTrip(value: unknown): unknown {
  return YAML.parse(toYaml(value));
}

describe('toYaml', () => {
  describe('scalars keep their type through a round trip', () => {
    it('preserves strings that look like booleans', () => {
      expect(roundTrip({ name: 'true' })).toEqual({ name: 'true' });
      expect(roundTrip({ name: 'false' })).toEqual({ name: 'false' });
    });

    it('preserves strings that look like numbers', () => {
      expect(roundTrip({ name: '123' })).toEqual({ name: '123' });
      expect(roundTrip({ name: '1.5' })).toEqual({ name: '1.5' });
      expect(roundTrip({ name: '-7' })).toEqual({ name: '-7' });
    });

    it('preserves strings that look like null', () => {
      expect(roundTrip({ name: 'null' })).toEqual({ name: 'null' });
    });

    it('preserves YAML 1.1 boolean spellings', () => {
      expect(roundTrip({ name: 'yes' })).toEqual({ name: 'yes' });
      expect(roundTrip({ name: 'no' })).toEqual({ name: 'no' });
      expect(roundTrip({ name: 'on' })).toEqual({ name: 'on' });
      expect(roundTrip({ name: 'off' })).toEqual({ name: 'off' });
    });

    it('keeps real booleans, numbers and null as themselves', () => {
      expect(roundTrip({ a: true, b: 42, c: null, d: 'plain' })).toEqual({
        a: true,
        b: 42,
        c: null,
        d: 'plain',
      });
    });
  });

  describe('nested collections', () => {
    // find_indirection_hotspots returns worstChains: CallChainStep[][],
    // so an array of arrays of objects is a real payload shape, not a corner case.
    it('round trips an array of arrays of objects', () => {
      const value = {
        worstChains: [
          [
            { name: 'a', file: 'f.ts', line: 1 },
            { name: 'b', file: 'g.ts', line: 2 },
          ],
          [{ name: 'c', file: 'h.ts', line: 3 }],
        ],
      };
      expect(roundTrip(value)).toEqual(value);
    });

    it('round trips an array of arrays of scalars', () => {
      const value = { rows: [['a', 'b'], ['c']] };
      expect(roundTrip(value)).toEqual(value);
    });

    it('round trips objects nested in objects', () => {
      const value = { summary: { errors: 1, nested: { deep: 'x' } } };
      expect(roundTrip(value)).toEqual(value);
    });

    it('round trips an empty array and empty object', () => {
      expect(roundTrip({ a: [], b: {} })).toEqual({ a: [], b: {} });
    });
  });

  describe('awkward strings', () => {
    it('round trips strings needing quotes', () => {
      const value = {
        colon: 'key: value',
        hash: '#tag',
        dash: '- item',
        multiline: 'line one\nline two',
        empty: '',
        quote: 'say "hi"',
      };
      expect(roundTrip(value)).toEqual(value);
    });

    it('round trips a snippet containing code punctuation', () => {
      const value = { snippet: 'export const x = { a: 1, b: [2, 3] };' };
      expect(roundTrip(value)).toEqual(value);
    });
  });
});
