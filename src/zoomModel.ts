import type { SlotId } from './appModel';

export type ZoomAction = 'in' | 'out' | 'reset';
export type PrimaryModifier = 'metaKey' | 'ctrlKey';

type ZoomKeyboardEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

export const PANEL_SELECTED_EVENT = 'ai-panel-selected';

export function panelWebviewLabel(slot: SlotId) {
  return `ai-panel-${slot.toLowerCase()}`;
}

export function slotFromPanelWebviewLabel(label: string): SlotId | null {
  const match = /^ai-panel-([a-d])$/.exec(label);
  return match ? (match[1].toUpperCase() as SlotId) : null;
}

export function zoomActionFromKeyboardEvent(
  event: ZoomKeyboardEvent,
  primaryModifier: PrimaryModifier,
): ZoomAction | null {
  if (!event[primaryModifier] || event.altKey) return null;
  if (event.key === '-') return 'out';
  if (event.key === '=' || event.key === '+') return 'in';
  if (event.key === '0') return 'reset';
  return null;
}

export function zoomTargetSlots(selectedSlot: SlotId | null, openSlots: SlotId[]): SlotId[] {
  return selectedSlot && openSlots.includes(selectedSlot) ? [selectedSlot] : [...openSlots];
}

export function normalizeSelectedSlot(selectedSlot: SlotId | null, openSlots: SlotId[]): SlotId | null {
  return selectedSlot && openSlots.includes(selectedSlot) ? selectedSlot : null;
}
