import type { SlotId } from './appModel';
import { slotFromPanelWebviewLabel } from './zoomModel';

export type PanelSyncGeneration = {
  isCurrent: () => boolean;
  invalidate: () => void;
  run: (task: () => Promise<void>) => Promise<void>;
};

export type PanelSyncCoordinator = {
  beginGeneration: () => PanelSyncGeneration;
};

export function createPanelSyncCoordinator(): PanelSyncCoordinator {
  let activeGeneration = 0;
  let queueTail = Promise.resolve();

  return {
    beginGeneration: () => {
      const generation = ++activeGeneration;
      const isCurrent = () => generation === activeGeneration;

      return {
        isCurrent,
        invalidate: () => {
          if (isCurrent()) activeGeneration += 1;
        },
        run: (task) => {
          const result = queueTail.catch(() => undefined).then(async () => {
            if (!isCurrent()) return;
            await task();
          });
          queueTail = result.catch(() => undefined);
          return result;
        },
      };
    },
  };
}

type ClosablePanelWebview = {
  close: () => Promise<unknown>;
};

type TrackedPanelWebviewEntry = {
  webview: ClosablePanelWebview & {
    hide: () => Promise<unknown>;
  };
};

export async function closeTrackedPanelWebview<Key, Entry extends TrackedPanelWebviewEntry>(
  entries: Map<Key, Entry>,
  key: Key,
  entry: Entry,
): Promise<void> {
  try {
    await entry.webview.close();
  } catch (error) {
    await entry.webview.hide().catch(() => undefined);
    throw error;
  }
  if (entries.get(key) === entry) entries.delete(key);
}

export function createPanelSelectionHandler(
  latestOpenSlots: () => readonly SlotId[],
  onPanelSelected: (slot: SlotId) => void,
): (label: string) => void {
  return (label) => {
    const slot = slotFromPanelWebviewLabel(label);
    if (slot && latestOpenSlots().includes(slot)) onPanelSelected(slot);
  };
}

export function reclaimStalePanelWebview(
  webview: ClosablePanelWebview,
  isCurrent: () => boolean,
): Promise<void> | null {
  if (isCurrent()) return null;
  return webview.close().then(() => undefined);
}
