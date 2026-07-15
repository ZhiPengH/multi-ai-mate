import { describe, expect, it } from 'vitest';
import { createPanelSyncCoordinator, reclaimStalePanelWebview } from './panelWebviewSync';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('panel WebView sync coordination', () => {
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
