export const MINIMUM_COSINE_OPTIONS = [
  { value: 'all', label: 'All scores' },
  { value: '0.5', label: '0.50' },
  { value: '0.65', label: '0.65' },
  { value: '0.78', label: '0.78' },
  { value: '0.85', label: '0.85' },
  { value: '0.9', label: '0.90' },
] as const;

export type MinimumCosineSelection = typeof MINIMUM_COSINE_OPTIONS[number]['value'];

export function parseMinimumCosineSelection(value: string): MinimumCosineSelection {
  return MINIMUM_COSINE_OPTIONS.some((option) => option.value === value)
    ? value as MinimumCosineSelection
    : 'all';
}

/** An "all scores" AI run uses the server-configured default threshold. */
export function minimumCosineRequestThreshold(selection: MinimumCosineSelection): number | null {
  return selection === 'all' ? null : Number(selection);
}

/** Rule-based relationships have no cosine score and are shown only with the all-scores filter. */
export function passesMinimumCosineFilter(score: unknown, selection: MinimumCosineSelection): boolean {
  if (selection === 'all') return true;
  return typeof score === 'number' && Number.isFinite(score) && score >= Number(selection);
}
