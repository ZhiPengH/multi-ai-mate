import { describe, expect, it } from 'vitest';
import type { SlotId } from './appModel';
import {
  closeTrackedPanelWebview,
  createPanelSelectionHandler,
  createPanelSyncCoordinator,
  reclaimStalePanelWebview,
} from './panelWebviewSync';

type TrackedEntry = {
  webview: {
    close: () => Promise<unknown>;
    hide: () => Promise<unknown>;
  };
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('panel WebView sync coordination', () => {
  it('retains and hides a tracked WebView when close rejects', async () => {
    const closeError = new Error('close failed');
    let hideCalls = 0;
    const entry: TrackedEntry = {
      webview: {
        close: async () => {
          throw closeError;
        },
        hide: async () => {
          hideCalls += 1;
        },
      },
    };
    const entries = new Map([['A', entry]]);

    await expect(closeTrackedPanelWebview(entries, 'A', entry)).rejects.toBe(closeError);

    expect(entries.get('A')).toBe(entry);
    expect(hideCalls).toBe(1);
  });

  it('deletes a tracked WebView only after close succeeds', async () => {
    let closeCalls = 0;
    const entry: TrackedEntry = {
      webview: {
        close: async () => {
          closeCalls += 1;
        },
        hide: async () => undefined,
      },
    };
    const entries = new Map([['A', entry]]);

    await closeTrackedPanelWebview(entries, 'A', entry);

    expect(closeCalls).toBe(1);
    expect(entries.has('A')).toBe(false);
  });

  it('does not delete a newer replacement when an older close resolves late', async () => {
    const releaseOldClose = deferred<void>();
    const oldEntry: TrackedEntry = {
      webview: {
        close: () => releaseOldClose.promise,
        hide: async () => undefined,
      },
    };
    const replacementEntry: TrackedEntry = {
      webview: {
        close: async () => undefined,
        hide: async () => undefined,
      },
    };
    const entries = new Map([['A', oldEntry]]);

    const closeOldEntry = closeTrackedPanelWebview(entries, 'A', oldEntry);
    entries.set('A', replacementEntry);
    releaseOldClose.resolve();
    await closeOldEntry;

    expect(entries.get('A')).toBe(replacementEntry);
  });

  it('ignores delayed selection from a slot that is no longer open and visible', () => {
    let openSlots: SlotId[] = ['A', 'B'];
    const selected: SlotId[] = [];

    const handleSelection = createPanelSelectionHandler(
      () => openSlots,
      (slot) => selected.push(slot),
    );

    openSlots = ['B'];
    handleSelection('ai-panel-a');
    handleSelection('ai-panel-b');

    expect(selected).toEqual(['B']);
  });

  it('reclaims a delayed stale creation before running the latest sync', async () => {
    const coordinator = createPanelSyncCoordinator();
    const firstGeneration = coordinator.beginGeneration();
    const firstStarted = deferred<void>();
    const releaseFirstCreate = deferred<void>();
    const events: string[] = [];
    const registered: string[] = [];

    const firstRun = firstGeneration.run(async () => {
      events.push('first-create-start');
      firstStarted.resolve();
      await releaseFirstCreate.promise;

      const staleWebview = {
        close: async () => {
          events.push('stale-close');
        },
      };
      const staleCleanup = reclaimStalePanelWebview(staleWebview, firstGeneration.isCurrent);
      if (staleCleanup) {
        await staleCleanup;
        return;
      }
      registered.push('stale');
    });

    await firstStarted.promise;
    firstGeneration.invalidate();

    const latestGeneration = coordinator.beginGeneration();
    const latestRun = latestGeneration.run(async () => {
      events.push('latest-run');
      registered.push('latest');
    });

    await Promise.resolve();
    expect(events).toEqual(['first-create-start']);

    releaseFirstCreate.resolve();
    await Promise.all([firstRun, latestRun]);

    expect(events).toEqual(['first-create-start', 'stale-close', 'latest-run']);
    expect(registered).toEqual(['latest']);
  });
});
