import { describe, expect, it } from 'vitest';
import type { SlotId } from './appModel';
import {
  closeTrackedPanelWebview,
  createPanelSelectionHandler,
  createPanelSyncCoordinator,
  settlePanelSelectionListener,
  trackAndReclaimStalePanelWebview,
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
    const entries = new Map<string, TrackedEntry>();

    const firstRun = firstGeneration.run(async () => {
      events.push('first-create-start');
      firstStarted.resolve();
      await releaseFirstCreate.promise;

      const staleEntry: TrackedEntry = {
        webview: {
          close: async () => {
            events.push('stale-close');
          },
          hide: async () => undefined,
        },
      };
      const staleCleanup = trackAndReclaimStalePanelWebview(
        entries,
        'A',
        staleEntry,
        firstGeneration.isCurrent,
      );
      if (staleCleanup) {
        await staleCleanup;
        return;
      }
      entries.set('A', staleEntry);
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

  it('tracks a stale creation so failed cleanup can be retried by the latest sync', async () => {
    const coordinator = createPanelSyncCoordinator();
    const firstGeneration = coordinator.beginGeneration();
    const firstStarted = deferred<void>();
    const releaseFirstCreate = deferred<void>();
    const closeError = new Error('stale close failed');
    const events: string[] = [];
    const entries = new Map<string, TrackedEntry>();
    const trackedAtClose: boolean[] = [];
    let closeCalls = 0;
    const entry: TrackedEntry = {
      webview: {
        close: async () => {
          closeCalls += 1;
          trackedAtClose.push(entries.get('A') === entry);
          events.push(`stale-close-${closeCalls}`);
          if (closeCalls === 1) throw closeError;
        },
        hide: async () => {
          events.push('stale-hide');
        },
      },
    };
    const firstRun = firstGeneration.run(async () => {
      events.push('first-create-start');
      firstStarted.resolve();
      await releaseFirstCreate.promise;

      const staleCleanup = trackAndReclaimStalePanelWebview(
        entries,
        'A',
        entry,
        firstGeneration.isCurrent,
      );
      if (staleCleanup) await staleCleanup;
    });

    await firstStarted.promise;
    firstGeneration.invalidate();

    const latestGeneration = coordinator.beginGeneration();
    const latestRun = latestGeneration.run(async () => {
      events.push('latest-run');
      const staleEntry = entries.get('A');
      if (staleEntry) await closeTrackedPanelWebview(entries, 'A', staleEntry);
    });

    releaseFirstCreate.resolve();
    const [firstResult, latestResult] = await Promise.allSettled([firstRun, latestRun]);

    expect(firstResult).toEqual({ status: 'rejected', reason: closeError });
    expect(latestResult).toEqual({ status: 'fulfilled', value: undefined });
    expect(events).toEqual([
      'first-create-start',
      'stale-close-1',
      'stale-hide',
      'latest-run',
      'stale-close-2',
    ]);
    expect(trackedAtClose).toEqual([true, true]);
    expect(entries.has('A')).toBe(false);
  });

  it('reports panel selection listener registration rejection', async () => {
    const listenError = new Error('listen failed');
    const reports: Array<[string, unknown]> = [];
    let registered = false;

    await settlePanelSelectionListener(
      Promise.reject(listenError),
      () => false,
      () => {
        registered = true;
      },
      (message, error) => reports.push([message, error]),
    );

    expect(registered).toBe(false);
    expect(reports).toEqual([['Failed to listen for Tauri panel selection', listenError]]);
  });
});
