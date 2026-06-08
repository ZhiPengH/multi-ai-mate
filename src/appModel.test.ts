import { describe, expect, it } from 'vitest';
import { EMPTY_COMPOSER_MESSAGE, normalizeProviderUrl, openTargetSlots, slotAtPoint, visibleSlots } from './appModel';

describe('app model', () => {
  it('returns stable visible slots for each AI mode', () => {
    expect(visibleSlots(1)).toEqual(['A']);
    expect(visibleSlots(2)).toEqual(['A', 'B']);
    expect(visibleSlots(3)).toEqual(['A', 'B', 'C']);
    expect(visibleSlots(4)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('targets only visible slots that currently have providers', () => {
    expect(
      openTargetSlots(4, {
        A: { provider: 'chatgpt' },
        B: { provider: 'claude' },
        C: { provider: null },
        D: { provider: 'kimi' },
      }),
    ).toEqual(['A', 'B', 'D']);
  });

  it('normalizes provider URLs for webviews', () => {
    expect(normalizeProviderUrl('chatgpt.com')).toBe('https://chatgpt.com');
    expect(normalizeProviderUrl('https://claude.ai/')).toBe('https://claude.ai');
    expect(normalizeProviderUrl(' http://localhost:3000/ ')).toBe('http://localhost:3000');
  });

  it('starts the composer empty', () => {
    expect(EMPTY_COMPOSER_MESSAGE).toBe('');
  });

  it('detects which visible panel contains a dragged provider', () => {
    const rects = [
      { slot: 'A' as const, left: 10, right: 110, top: 20, bottom: 220 },
      { slot: 'B' as const, left: 118, right: 218, top: 20, bottom: 220 },
    ];

    expect(slotAtPoint(rects, 64, 90)).toBe('A');
    expect(slotAtPoint(rects, 180, 90)).toBe('B');
    expect(slotAtPoint(rects, 114, 90)).toBeNull();
  });
});
