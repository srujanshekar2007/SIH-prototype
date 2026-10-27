import { describe, expect, it } from 'vitest';
import {
  MINIMUM_COSINE_OPTIONS,
  minimumCosineRequestThreshold,
  parseMinimumCosineSelection,
  passesMinimumCosineFilter,
} from '../overlap-threshold';

describe('Overlap Monitoring minimum cosine score', () => {
  it('keeps the visible options and maps each numeric selection to the API value', () => {
    expect(MINIMUM_COSINE_OPTIONS.map(({ value }) => value)).toEqual(['all', '0.5', '0.65', '0.78', '0.85', '0.9']);
    for (const value of ['0.5', '0.65', '0.78', '0.85', '0.9'] as const) {
      expect(parseMinimumCosineSelection(value)).toBe(value);
      expect(minimumCosineRequestThreshold(value)).toBe(Number(value));
    }
    expect(minimumCosineRequestThreshold('all')).toBeNull();
  });

  it('includes rule-based rows only in All scores and filters semantic scores inclusively', () => {
    expect(passesMinimumCosineFilter(null, 'all')).toBe(true);
    expect(passesMinimumCosineFilter(null, '0.5')).toBe(false);
    for (const value of ['0.5', '0.65', '0.78', '0.85', '0.9'] as const) {
      const threshold = Number(value);
      expect(passesMinimumCosineFilter(threshold, value)).toBe(true);
      expect(passesMinimumCosineFilter(threshold - 0.001, value)).toBe(false);
    }
    expect(passesMinimumCosineFilter(Number.NaN, '0.5')).toBe(false);
  });

  it('falls back safely for an unknown UI selection', () => {
    expect(parseMinimumCosineSelection('not-an-option')).toBe('all');
  });
});
