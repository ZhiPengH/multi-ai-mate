import { describe, expect, it } from 'vitest';
import { normalizeProviderUrl, openTargetSlots, visibleSlots } from './appModel';

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
});
