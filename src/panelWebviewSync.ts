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

export function reclaimStalePanelWebview(
  webview: ClosablePanelWebview,
  isCurrent: () => boolean,
): Promise<void> | null {
  if (isCurrent()) return null;
  return webview.close().then(() => undefined);
}
