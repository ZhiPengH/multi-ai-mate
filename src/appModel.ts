export type Mode = 1 | 2 | 3 | 4;
export type SlotId = 'A' | 'B' | 'C' | 'D';

export type ProviderSlot = {
  provider: string | null;
};

export const SLOT_ORDER: SlotId[] = ['A', 'B', 'C', 'D'];

export function visibleSlots(mode: Mode): SlotId[] {
  return SLOT_ORDER.slice(0, mode);
}

export function openTargetSlots<T extends Record<SlotId, ProviderSlot>>(mode: Mode, slots: T): SlotId[] {
  return visibleSlots(mode).filter((slot) => slots[slot].provider);
}

export function normalizeProviderUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed || 'example.com'}`;
}
