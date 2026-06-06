import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Webview as TauriWebview } from '@tauri-apps/api/webview';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mode, normalizeProviderUrl, SlotId, SLOT_ORDER, visibleSlots } from './appModel';

type ProviderLike = {
  id: string;
  url: string;
};

type SlotLike = {
  provider: string | null;
};

type NativeWebviewEntry = {
  providerId: string;
  url: string;
  webview: TauriWebview;
};

type TauriPanelWebviewsOptions = {
  mode: Mode;
  slots: Record<SlotId, SlotLike>;
  providersById: Record<string, ProviderLike | undefined>;
  panelBodyRefs: React.MutableRefObject<Record<SlotId, HTMLDivElement | null>>;
  suspended: boolean;
};

export type TauriPanelWebviewControls = {
  enabled: boolean;
  focusSlot: (slot: SlotId) => Promise<void>;
  reloadSlots: (slots: SlotId[]) => Promise<void>;
  sendToSlots: (slots: SlotId[], text: string, autoSubmit?: boolean) => Promise<void>;
};

type NativeSendResult = {
  ok?: boolean;
  reason?: string;
  submitted?: boolean;
};

function webviewLabel(slot: SlotId) {
  return `ai-panel-${slot.toLowerCase()}`;
}

function panelBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function useTauriPanelWebviews({
  mode,
  slots,
  providersById,
  panelBodyRefs,
  suspended,
}: TauriPanelWebviewsOptions): TauriPanelWebviewControls {
  const [enabled, setEnabled] = useState(false);
  const webviewsRef = useRef(new Map<SlotId, NativeWebviewEntry>());

  useEffect(() => {
    setEnabled(isTauri());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    async function syncWebviews() {
      const [{ Webview }, { getCurrentWindow }, { LogicalPosition, LogicalSize }] = await Promise.all([
        import('@tauri-apps/api/webview'),
        import('@tauri-apps/api/window'),
        import('@tauri-apps/api/dpi'),
      ]);

      if (disposed) return;

      const currentWindow = getCurrentWindow();
      const activeSlots = new Set(visibleSlots(mode));

      for (const slot of SLOT_ORDER) {
        const existing = webviewsRef.current.get(slot);
        const providerId = activeSlots.has(slot) ? slots[slot].provider : null;
        const provider = providerId ? providersById[providerId] : undefined;

        if (!provider) {
          if (existing) {
            webviewsRef.current.delete(slot);
            await existing.webview.close().catch(() => undefined);
          }
          continue;
        }

        const element = panelBodyRefs.current[slot];
        if (!element) continue;

        const url = normalizeProviderUrl(provider.url);
        const bounds = panelBounds(element);

        if (existing && (existing.providerId !== provider.id || existing.url !== url)) {
          webviewsRef.current.delete(slot);
          await existing.webview.close().catch(() => undefined);
        }

        const current = webviewsRef.current.get(slot);
        if (current) {
          await current.webview.setPosition(new LogicalPosition(bounds.x, bounds.y)).catch(() => undefined);
          await current.webview.setSize(new LogicalSize(bounds.width, bounds.height)).catch(() => undefined);
          await (suspended ? current.webview.hide() : current.webview.show()).catch(() => undefined);
          continue;
        }

        const webview = new Webview(currentWindow, webviewLabel(slot), {
          url,
          ...bounds,
        });

        webviewsRef.current.set(slot, {
          providerId: provider.id,
          url,
          webview,
        });

        if (suspended) {
          await webview.hide().catch(() => undefined);
        }
      }
    }

    const run = () => {
      syncWebviews().catch((error) => {
        console.error('Failed to sync Tauri webviews', error);
      });
    };

    run();

    const resizeObserver = new ResizeObserver(run);
    SLOT_ORDER.forEach((slot) => {
      const element = panelBodyRefs.current[slot];
      if (element) resizeObserver.observe(element);
    });

    window.addEventListener('resize', run);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', run);
    };
  }, [enabled, mode, panelBodyRefs, providersById, slots, suspended]);

  useEffect(() => {
    return () => {
      webviewsRef.current.forEach((entry) => {
        entry.webview.close().catch(() => undefined);
      });
      webviewsRef.current.clear();
    };
  }, []);

  const focusSlot = useCallback(
    async (slot: SlotId) => {
      if (!enabled) return;
      await invoke('panel_webview_focus', { label: webviewLabel(slot) });
    },
    [enabled],
  );

  const reloadSlots = useCallback(
    async (targetSlots: SlotId[]) => {
      if (!enabled) return;
      await Promise.all(
        targetSlots
          .filter((slot) => webviewsRef.current.has(slot))
          .map((slot) => invoke('panel_webview_reload', { label: webviewLabel(slot) })),
      );
    },
    [enabled],
  );

  const sendToSlots = useCallback(
    async (targetSlots: SlotId[], text: string, autoSubmit = true) => {
      if (!enabled) return;
      const results = await Promise.all(
        targetSlots
          .filter((slot) => webviewsRef.current.has(slot))
          .map(async (slot) => {
            const raw = await invoke<string>('panel_webview_send', {
              label: webviewLabel(slot),
              text,
              autoSubmit,
            });
            let parsed: NativeSendResult;
            try {
              parsed = JSON.parse(raw) as NativeSendResult;
            } catch {
              parsed = { ok: true };
            }
            return { slot, ...parsed };
          }),
      );

      const failed = results.find((result) => result.ok === false);
      if (failed) {
        throw new Error(`${failed.slot}: ${failed.reason ?? 'send-failed'}`);
      }
    },
    [enabled],
  );

  return useMemo(
    () => ({
      enabled,
      focusSlot,
      reloadSlots,
      sendToSlots,
    }),
    [enabled, focusSlot, reloadSlots, sendToSlots],
  );
}
