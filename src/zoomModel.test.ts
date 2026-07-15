import { describe, expect, it } from 'vitest';
import {
  normalizeSelectedSlot,
  panelWebviewLabel,
  slotFromPanelWebviewLabel,
  zoomActionFromKeyboardEvent,
  zoomTargetSlots,
} from './zoomModel';

const shortcut = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

describe('zoom model', () => {
  it('parses only supported primary-modifier zoom shortcuts', () => {
    expect(zoomActionFromKeyboardEvent(shortcut('-', { metaKey: true }), 'metaKey')).toBe('out');
    expect(zoomActionFromKeyboardEvent(shortcut('=', { metaKey: true }), 'metaKey')).toBe('in');
    expect(zoomActionFromKeyboardEvent(shortcut('+', { ctrlKey: true }), 'ctrlKey')).toBe('in');
    expect(zoomActionFromKeyboardEvent(shortcut('0', { metaKey: true }), 'metaKey')).toBe('reset');
    expect(
      zoomActionFromKeyboardEvent(shortcut('-', { altKey: true, metaKey: true }), 'metaKey'),
    ).toBeNull();
    expect(zoomActionFromKeyboardEvent(shortcut('-'), 'metaKey')).toBeNull();
  });

  it('rejects Ctrl as the primary modifier on macOS', () => {
    expect(zoomActionFromKeyboardEvent(shortcut('-', { ctrlKey: true }), 'metaKey')).toBeNull();
  });

  it('rejects Meta as the primary modifier on Windows and Linux', () => {
    expect(zoomActionFromKeyboardEvent(shortcut('-', { metaKey: true }), 'ctrlKey')).toBeNull();
  });

  it('targets one valid selection or every open slot in global mode', () => {
    expect(zoomTargetSlots('B', ['A', 'B'])).toEqual(['B']);
    expect(zoomTargetSlots(null, ['A', 'B'])).toEqual(['A', 'B']);
    expect(zoomTargetSlots('C', ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('maps only known panel labels to slots', () => {
    expect(panelWebviewLabel('D')).toBe('ai-panel-d');
    expect(slotFromPanelWebviewLabel('ai-panel-a')).toBe('A');
    expect(slotFromPanelWebviewLabel('ai-panel-d')).toBe('D');
    expect(slotFromPanelWebviewLabel('main')).toBeNull();
    expect(slotFromPanelWebviewLabel('ai-panel-e')).toBeNull();
  });

  it('clears a selection that is no longer open and visible', () => {
    expect(normalizeSelectedSlot('A', ['A', 'B'])).toBe('A');
    expect(normalizeSelectedSlot('C', ['A', 'B'])).toBeNull();
    expect(normalizeSelectedSlot(null, ['A', 'B'])).toBeNull();
  });
});
