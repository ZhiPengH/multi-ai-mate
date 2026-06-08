import {
  Camera,
  ChevronDown,
  Moon,
  Paperclip,
  SendHorizontal,
  Sun,
  Trash2,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ChangeEvent, DragEvent, KeyboardEvent, MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_COMPOSER_MESSAGE,
  Mode,
  normalizeProviderUrl,
  openTargetSlots,
  slotAtPoint,
  SlotId,
  SLOT_ORDER,
  visibleSlots,
} from './appModel';
import { useTauriPanelWebviews } from './useTauriPanelWebviews';

type SlotStatus = 'ready' | 'loading' | 'empty';
type Theme = 'light' | 'dark';

type Provider = {
  id: string;
  name: string;
  glyph: string;
  url: string;
  hue: string;
  cjk?: boolean;
  icon?: string;
  iconSm?: string;
  custom?: boolean;
};

type SlotState = {
  provider: string | null;
  status: SlotStatus;
  messages: Message[];
};

type Message = {
  id: string;
  role: 'user' | 'ai';
  provider?: string;
  text?: string;
  loading?: boolean;
};

type PointerDragState = {
  providerId: string;
  x: number;
  y: number;
};

const BASE_PROVIDERS: Provider[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    glyph: 'GPT',
    icon: '/assets/chatgpt.png',
    iconSm: '/assets/chatgpt-sm.png',
    url: 'chatgpt.com',
    hue: 'oklch(.6 .07 162)',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    glyph: 'Gem',
    icon: '/assets/gemini.png',
    iconSm: '/assets/gemini-sm.png',
    url: 'gemini.google.com',
    hue: 'oklch(.6 .08 256)',
  },
  {
    id: 'claude',
    name: 'Claude',
    glyph: 'Cla',
    icon: '/assets/claude.png',
    iconSm: '/assets/claude-sm.png',
    url: 'claude.ai',
    hue: 'oklch(.62 .085 52)',
  },
  {
    id: 'grok',
    name: 'Grok',
    glyph: 'Grok',
    icon: '/assets/grok.png',
    iconSm: '/assets/grok-sm.png',
    url: 'grok.com',
    hue: 'oklch(.48 .02 270)',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    glyph: 'DS',
    icon: '/assets/deepseek.png',
    iconSm: '/assets/deepseek-sm.png',
    url: 'chat.deepseek.com',
    hue: 'oklch(.58 .08 268)',
  },
  {
    id: 'doubao',
    name: '豆包',
    glyph: '豆包',
    icon: '/assets/doubao.png',
    iconSm: '/assets/doubao-sm.png',
    url: 'www.doubao.com/chat/',
    hue: 'oklch(.62 .075 248)',
    cjk: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    glyph: 'Kimi',
    icon: '/assets/kimi.png',
    iconSm: '/assets/kimi-sm.png',
    url: 'www.kimi.com',
    hue: 'oklch(.56 .07 300)',
  },
];

const CUSTOM_HUES = [
  'oklch(.6 .08 24)',
  'oklch(.6 .08 140)',
  'oklch(.58 .08 200)',
  'oklch(.58 .08 312)',
  'oklch(.6 .07 90)',
  'oklch(.56 .07 280)',
];

const STORAGE_KEY = 'multi-ai-mate.workspace.v1';

type PersistedWorkspace = {
  theme?: Theme;
  mode?: Mode;
  providers?: Provider[];
  slots?: Partial<Record<SlotId, string | null>>;
};

const starterMessages = (provider: string): Message[] => [
  {
    id: crypto.randomUUID(),
    role: 'ai',
    provider,
    text: '',
  },
];

const initialSlots: Record<SlotId, SlotState> = {
  A: { provider: 'chatgpt', status: 'ready', messages: starterMessages('chatgpt') },
  B: { provider: 'claude', status: 'ready', messages: starterMessages('claude') },
  C: { provider: 'gemini', status: 'ready', messages: starterMessages('gemini') },
  D: { provider: null, status: 'empty', messages: [] },
};

function isMode(value: unknown): value is Mode {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function slotState(provider: string | null): SlotState {
  return provider
    ? { provider, status: 'ready', messages: starterMessages(provider) }
    : { provider: null, status: 'empty', messages: [] };
}

function readPersistedWorkspace(): PersistedWorkspace | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isCustomProvider(provider: unknown): provider is Provider {
  if (!provider || typeof provider !== 'object') return false;
  const candidate = provider as Partial<Provider>;
  return Boolean(
    candidate.custom &&
      typeof candidate.id === 'string' &&
      candidate.id.startsWith('custom-') &&
      typeof candidate.name === 'string' &&
      typeof candidate.glyph === 'string' &&
      typeof candidate.url === 'string' &&
      typeof candidate.hue === 'string',
  );
}

function deriveGlyph(name: string) {
  const cjk = name.match(/[\u4e00-\u9fff]/);
  if (cjk) return cjk[0];
  const first = name.replace(/[^a-z0-9]/i, '').charAt(0) || name.charAt(0);
  return first.toUpperCase();
}

function normalizeUrl(url: string) {
  return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'example.com';
}

function providerMap(providers: Provider[]) {
  return Object.fromEntries(providers.map((provider) => [provider.id, provider]));
}

function isCjk(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

export function App() {
  const persistedWorkspace = useMemo(readPersistedWorkspace, []);
  const [theme, setTheme] = useState<Theme>(() =>
    persistedWorkspace?.theme === 'dark' || persistedWorkspace?.theme === 'light' ? persistedWorkspace.theme : 'light',
  );
  const [mode, setMode] = useState<Mode>(() => (isMode(persistedWorkspace?.mode) ? persistedWorkspace.mode : 2));
  const [providers, setProviders] = useState<Provider[]>(() => {
    const customProviders = (persistedWorkspace?.providers ?? []).filter(isCustomProvider);
    return [...BASE_PROVIDERS, ...customProviders];
  });
  const [slots, setSlots] = useState<Record<SlotId, SlotState>>(() => {
    const providerIds = new Set([
      ...BASE_PROVIDERS.map((provider) => provider.id),
      ...(persistedWorkspace?.providers ?? []).filter(isCustomProvider).map((provider) => provider.id),
    ]);
    const savedSlots = persistedWorkspace?.slots;
    if (!savedSlots) return initialSlots;

    return {
      A: slotState(savedSlots.A && providerIds.has(savedSlots.A) ? savedSlots.A : null),
      B: slotState(savedSlots.B && providerIds.has(savedSlots.B) ? savedSlots.B : null),
      C: slotState(savedSlots.C && providerIds.has(savedSlots.C) ? savedSlots.C : null),
      D: slotState(savedSlots.D && providerIds.has(savedSlots.D) ? savedSlots.D : null),
    };
  });
  const [draggingProvider, setDraggingProvider] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<SlotId | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [message, setMessage] = useState(EMPTY_COMPOSER_MESSAGE);
  const [toast, setToast] = useState<{ text: string; spinning?: boolean } | null>(null);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customIcon, setCustomIcon] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimer = useRef<number | null>(null);
  const panelBodyRefs = useRef<Record<SlotId, HTMLDivElement | null>>({
    A: null,
    B: null,
    C: null,
    D: null,
  });
  const panelRefs = useRef<Record<SlotId, HTMLElement | null>>({
    A: null,
    B: null,
    C: null,
    D: null,
  });
  const providersById = useMemo(() => providerMap(providers), [providers]);
  const activeSlots = visibleSlots(mode);
  const openSlots = openTargetSlots(mode, slots);
  const nativeWebviews = useTauriPanelWebviews({
    mode,
    slots,
    providersById,
    panelBodyRefs,
    suspended: Boolean(draggingProvider),
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const payload: PersistedWorkspace = {
      theme,
      mode,
      providers: providers.filter((provider) => provider.custom),
      slots: {
        A: slots.A.provider,
        B: slots.B.provider,
        C: slots.C.provider,
        D: slots.D.provider,
      },
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('Failed to persist workspace', error);
    }
  }, [mode, providers, slots.A.provider, slots.B.provider, slots.C.provider, slots.D.provider, theme]);

  useEffect(() => {
    if (!toast || toast.spinning) return;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        refreshAllOpen();
        return;
      }

      const shortcutSlot = slotFromDigitCode(event.code);
      if (!shortcutSlot) return;

      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        event.preventDefault();
        reloadSlot(shortcutSlot);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.altKey) {
        event.preventDefault();
        closeSlot(shortcutSlot);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    autoGrow();
  }, [message]);

  function showToast(text: string, spinning = false) {
    setToast({ text, spinning });
  }

  function setSlotLoading(slot: SlotId, providerId: string) {
    window.setTimeout(() => {
      setSlots((current) => {
        if (current[slot].provider !== providerId) return current;
        return {
          ...current,
          [slot]: { ...current[slot], status: 'ready' },
        };
      });
    }, 780);
  }

  function loadProvider(slot: SlotId, providerId: string) {
    setSlots((current) => ({
      ...current,
      [slot]: {
        provider: providerId,
        status: 'loading',
        messages: starterMessages(providerId),
      },
    }));
    setSlotLoading(slot, providerId);
  }

  function closeSlot(slot: SlotId) {
    setSlots((current) => ({
      ...current,
      [slot]: { provider: null, status: 'empty', messages: [] },
    }));
  }

  function reloadSlot(slot: SlotId) {
    const providerId = slots[slot].provider;
    if (!providerId) return;
    void nativeWebviews.reloadSlots([slot]).catch((error) => {
      console.error('Failed to reload native webview', error);
      showToast('刷新失败');
    });
    setSlots((current) => ({
      ...current,
      [slot]: { ...current[slot], status: 'loading' },
    }));
    setSlotLoading(slot, providerId);
  }

  function refreshAllOpen() {
    const targets = openSlots;
    if (!targets.length) {
      showToast('没有可刷新的面板');
      return;
    }

    showToast(`正在刷新 ${targets.length} 个面板...`, true);
    void nativeWebviews.reloadSlots(targets).catch((error) => {
      console.error('Failed to reload native webviews', error);
      showToast('刷新失败');
    });
    setSlots((current) => {
      const next = { ...current };
      targets.forEach((slot) => {
        next[slot] = { ...next[slot], status: 'loading' };
      });
      return next;
    });

    window.setTimeout(() => {
      setSlots((current) => {
        const next = { ...current };
        targets.forEach((slot) => {
          if (next[slot].provider) next[slot] = { ...next[slot], status: 'ready' };
        });
        return next;
      });
      showToast(`已刷新 ${targets.length} 个面板`);
    }, 900);
  }

  function sendMessage() {
    const text = message.trim();
    if (!text || !openSlots.length) return;

    const pendingIds: Array<{ slot: SlotId; id: string; provider: string }> = [];
    setSlots((current) => {
      const next = { ...current };
      openSlots.forEach((slot) => {
        const provider = current[slot].provider;
        if (!provider) return;
        const aiId = crypto.randomUUID();
        pendingIds.push({ slot, id: aiId, provider });
        next[slot] = {
          ...current[slot],
          messages: [
            ...current[slot].messages,
            { id: crypto.randomUUID(), role: 'user', text },
            { id: aiId, role: 'ai', provider, loading: true },
          ],
        };
      });
      return next;
    });

    pendingIds.forEach(({ slot, id }) => {
      window.setTimeout(
        () => {
          setSlots((current) => ({
            ...current,
            [slot]: {
              ...current[slot],
              messages: current[slot].messages.map((entry) =>
                entry.id === id ? { ...entry, loading: false, text: '' } : entry,
              ),
            },
          }));
        },
        680 + Math.random() * 460,
      );
    });

    setMessage('');
    showToast(`正在发送至 ${openSlots.length} 个 AI`, true);
    void nativeWebviews
      .sendToSlots(openSlots, text, true)
      .then(() => {
        showToast(`已发送至 ${openSlots.length} 个 AI`);
      })
      .catch((error) => {
        console.error('Failed to send message to native webviews', error);
        showToast('发送失败：请先在目标网页登录或手动聚焦输入框');
      });
  }

  function autoGrow() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 120)}px`;
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  }

  function slotFromDigitCode(code: string): SlotId | null {
    const match = code.match(/^Digit([1-4])$/);
    if (!match) return null;
    const slot = SLOT_ORDER[Number(match[1]) - 1];
    return activeSlots.includes(slot) ? slot : null;
  }

  function startTitlebarDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, [data-no-drag]')) return;
    if (!isTauri()) return;

    getCurrentWindow().startDragging().catch((error) => {
      console.error('Failed to start titlebar drag', error);
    });
  }

  function onDragStart(providerId: string, event: DragEvent<HTMLElement>) {
    event.dataTransfer.setData('text/plain', providerId);
    event.dataTransfer.effectAllowed = 'copy';
    setDraggingProvider(providerId);
  }

  function onDragEnd() {
    setDraggingProvider(null);
    setDropSlot(null);
  }

  function slotFromClientPoint(x: number, y: number) {
    const rects = activeSlots
      .map((slot) => {
        const rect = panelRefs.current[slot]?.getBoundingClientRect();
        return rect
          ? {
              slot,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            }
          : null;
      })
      .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));

    return slotAtPoint(rects, x, y);
  }

  function onProviderPointerDown(providerId: string, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    setDraggingProvider(providerId);
    setPointerDrag({ providerId, x: event.clientX, y: event.clientY });

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      setPointerDrag((current) =>
        current?.providerId === providerId ? { providerId, x: moveEvent.clientX, y: moveEvent.clientY } : current,
      );
      setDropSlot(slotFromClientPoint(moveEvent.clientX, moveEvent.clientY));
    };

    const finishPointerDrag = (upEvent: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', finishPointerDrag);

      const slot = slotFromClientPoint(upEvent.clientX, upEvent.clientY);
      setPointerDrag(null);
      setDraggingProvider(null);
      setDropSlot(null);

      if (!slot || !providersById[providerId]) return;
      loadProvider(slot, providerId);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishPointerDrag);
    window.addEventListener('pointercancel', finishPointerDrag);
  }

  function onPanelDrop(slot: SlotId, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const providerId = event.dataTransfer.getData('text/plain');
    setDropSlot(null);
    if (!providersById[providerId]) return;
    loadProvider(slot, providerId);
  }

  function slotFromDropPoint(event: DragEvent<HTMLElement>) {
    return slotFromClientPoint(event.clientX, event.clientY);
  }

  function onWorkspaceDragOver(event: DragEvent<HTMLElement>) {
    if (!draggingProvider) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropSlot(slotFromDropPoint(event));
  }

  function onWorkspaceDrop(event: DragEvent<HTMLElement>) {
    if (!draggingProvider) return;
    event.preventDefault();
    const providerId = event.dataTransfer.getData('text/plain') || draggingProvider;
    const slot = slotFromDropPoint(event);
    setDropSlot(null);
    if (!slot || !providersById[providerId]) return;
    loadProvider(slot, providerId);
  }

  function removeProvider(providerId: string) {
    const provider = providersById[providerId];
    if (!provider?.custom) return;

    setProviders((current) => current.filter((item) => item.id !== providerId));
    setSlots((current) => {
      const next = { ...current };
      SLOT_ORDER.forEach((slot) => {
        if (next[slot].provider === providerId) {
          next[slot] = { provider: null, status: 'empty', messages: [] };
        }
      });
      return next;
    });
    showToast(`已删除 ${provider.name}`);
  }

  function onTrashDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const providerId = event.dataTransfer.getData('text/plain');
    removeProvider(providerId);
  }

  function openCustomDialog() {
    setCustomName('');
    setCustomUrl('');
    setCustomIcon(null);
    setIsCustomOpen(true);
  }

  function handleIconFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      showToast('请选择图片文件');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      showToast('图片过大（上限 4MB）');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setCustomIcon(String(reader.result));
    reader.onerror = () => showToast('无法读取该图片');
    reader.readAsDataURL(file);
  }

  function addCustomProvider() {
    const name = customName.trim();
    if (!name) return;

    const customIndex = providers.filter((provider) => provider.custom).length;
    const next: Provider = {
      id: `custom-${Date.now()}`,
      name,
      glyph: deriveGlyph(name),
        url: normalizeUrl(customUrl),
      hue: CUSTOM_HUES[customIndex % CUSTOM_HUES.length],
      icon: customIcon ?? undefined,
      cjk: isCjk(name),
      custom: true,
    };

    setProviders((current) => [...current, next]);
    setIsCustomOpen(false);
    showToast(`已添加 ${name} · 拖到面板加载`);
  }

  return (
    <main className={`app ${nativeWebviews.enabled ? 'native-webviews' : ''}`}>
      <header className="titlebar" data-tauri-drag-region onMouseDown={startTitlebarDrag}>
        <div className="titlebar-spacer" aria-hidden="true" />

        <div className="title-mid">
          <img className="brand-mark" src="/assets/brand.png" alt="" />
          <h1>Multi AI Mate</h1>
        </div>

        <div className="title-right" data-no-drag>
          <nav className="modes" aria-label="AI mode">
            <span className="thumb" style={{ transform: `translateX(${(mode - 1) * 92}px)` }} />
            {([1, 2, 3, 4] as Mode[]).map((item) => (
              <button
                className="mode-btn"
                key={item}
                type="button"
                aria-pressed={mode === item}
                onClick={() => setMode(item)}
              >
                <span className="n">{item}</span> AI
              </button>
            ))}
          </nav>
          <button
            className="appearance"
            type="button"
            title="切换外观"
            aria-label="切换外观"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
        </div>
      </header>

      <aside className="dock" aria-label="AI 库">
        <div className="dock-scroll">
          {providers.map((provider) => (
            <ProviderTile
              key={provider.id}
              provider={provider}
              draggingProvider={draggingProvider}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onPointerDown={onProviderPointerDown}
            />
          ))}
          <div className="dock-sep" />
          <button
            className={`tile custom ${draggingProvider ? 'trash' : ''}`}
            type="button"
            id="addTile"
            onClick={draggingProvider ? undefined : openCustomDialog}
            onDragOver={(event) => {
              if (!draggingProvider) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={onTrashDrop}
          >
            <span className="glyph">{draggingProvider ? <Trash2 /> : '+'}</span>
          </button>
        </div>
      </aside>

      <section className={`workspace m${mode} ${draggingProvider ? 'dragging' : ''}`}>
        {SLOT_ORDER.map((slot) => (
          <Panel
            key={slot}
            slot={slot}
            state={slots[slot]}
            provider={slots[slot].provider ? providersById[slots[slot].provider] : null}
            visible={activeSlots.includes(slot)}
            auxiliary={(slot === 'C' || slot === 'D') && mode >= 3}
            dropping={dropSlot === slot}
            mode={mode}
            panelRef={(node) => {
              panelRefs.current[slot] = node;
            }}
            bodyRef={(node) => {
              panelBodyRefs.current[slot] = node;
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDropSlot(slot);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropSlot(null);
            }}
            onDrop={(event) => onPanelDrop(slot, event)}
          />
        ))}
        {draggingProvider && (
          <div
            className="workspace-drop-layer"
            aria-hidden="true"
            onDragOver={onWorkspaceDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropSlot(null);
            }}
            onDrop={onWorkspaceDrop}
          />
        )}
      </section>

      <footer className="composer">
        <div className="composer-row">
          <div className="field">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="输入消息..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onComposerKeyDown}
            />
            <div className="tools">
              <button className="icon-btn" title="附件" aria-label="附件" type="button">
                <Paperclip />
              </button>
            </div>
          </div>
          <button className="send" type="button" onClick={sendMessage} disabled={!message.trim() || !openSlots.length}>
            <SendHorizontal />
            发送 <span className="kbd">⌘↵</span>
          </button>
        </div>
      </footer>

      {toast && (
        <div className="toast show">
          {toast.spinning && <span className="spin" />}
          {toast.text}
        </div>
      )}

      {pointerDrag?.providerId && providersById[pointerDrag.providerId] && (
        <DragGhost provider={providersById[pointerDrag.providerId]} x={pointerDrag.x} y={pointerDrag.y} />
      )}

      {isCustomOpen && (
        <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && setIsCustomOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="添加自定义 AI">
            <div className="modal-head">
              <label className={`modal-icon ${customIcon ? 'has-img' : ''}`} title="选择图标（可选）">
                {customIcon ? <img className="mi-img" src={customIcon} alt="icon" /> : <span className="mi-glyph">+</span>}
                <span className="mi-badge" aria-hidden="true">
                  <Camera />
                </span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={handleIconFile} />
              </label>
              <div>
                <h2>添加自定义 AI</h2>
                <p>填入名称和网址；可选择图标，留空则用名称首字母。</p>
              </div>
            </div>
            <label className="modal-field">
              <span>名称</span>
              <input
                type="text"
                placeholder="例如 Perplexity"
                maxLength={20}
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addCustomProvider();
                }}
                autoFocus
              />
            </label>
            <label className="modal-field">
              <span>网址</span>
              <input
                type="text"
                placeholder="例如 perplexity.ai"
                value={customUrl}
                onChange={(event) => setCustomUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addCustomProvider();
                }}
              />
            </label>
            <div className="modal-actions">
              <button className="btn-ghost" type="button" onClick={() => setIsCustomOpen(false)}>
                取消
              </button>
              <button className="btn-accent" type="button" onClick={addCustomProvider}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ProviderTile({
  provider,
  draggingProvider,
  onDragStart,
  onDragEnd,
  onPointerDown,
}: {
  provider: Provider;
  draggingProvider: string | null;
  onDragStart: (providerId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onPointerDown: (providerId: string, event: PointerEvent<HTMLElement>) => void;
}) {
  const solo = !provider.icon && [...provider.glyph].length === 1;

  return (
    <div
      className={`tile ${provider.cjk ? 'cjk' : ''} ${provider.icon ? 'img' : ''} ${solo ? 'solo' : ''} ${
        draggingProvider === provider.id ? 'dragging' : ''
      }`}
      draggable
      data-provider={provider.id}
      style={{ '--g': provider.hue } as React.CSSProperties}
      onDragStart={(event) => onDragStart(provider.id, event)}
      onDragEnd={onDragEnd}
      onPointerDown={(event) => onPointerDown(provider.id, event)}
    >
      {provider.icon ? (
        <img className="glyph ico" src={provider.icon} alt={provider.name} draggable={false} />
      ) : (
        <span className="glyph">{provider.glyph}</span>
      )}
    </div>
  );
}

function DragGhost({ provider, x, y }: { provider: Provider; x: number; y: number }) {
  return (
    <div className="drag-ghost" style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}>
      {provider.icon ? (
        <img src={provider.icon} alt="" draggable={false} />
      ) : (
        <span className={provider.cjk ? 'cjk' : ''}>{provider.glyph}</span>
      )}
    </div>
  );
}

function Panel({
  slot,
  state,
  provider,
  visible,
  auxiliary,
  dropping,
  mode,
  bodyRef,
  panelRef,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  slot: SlotId;
  state: SlotState;
  provider: Provider | null;
  visible: boolean;
  auxiliary: boolean;
  dropping: boolean;
  mode: Mode;
  bodyRef: (node: HTMLDivElement | null) => void;
  panelRef: (node: HTMLElement | null) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <article
      className={`panel ${auxiliary ? 'aux' : ''} ${visible ? '' : 'hidden'} ${dropping ? 'drop' : ''}`}
      data-slot={slot}
      ref={panelRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="panel-head">
        <PanelBadge provider={provider} />
        <div className="pv-name">
          <span className="nm">{provider ? provider.name : '空槽位'}</span>
        </div>
      </div>

      <div className="panel-body" ref={bodyRef}>
        {provider ? <WebPreview slot={slot} provider={provider} state={state} mode={mode} /> : <EmptySlot />}
        <div className="drop-veil">
          <span className="pill">释放加载</span>
        </div>
      </div>
    </article>
  );
}

function PanelBadge({ provider }: { provider: Provider | null }) {
  if (!provider) return <div className="slot-badge empty-mark">+</div>;
  if (provider.iconSm || provider.icon) {
    return (
      <div className="slot-badge img">
        <img src={provider.iconSm ?? provider.icon} alt={provider.name} />
      </div>
    );
  }
  return (
    <div
      className={`slot-badge glyph ${provider.cjk ? 'cjk' : ''}`}
      style={
        {
          background: `linear-gradient(160deg, color-mix(in oklab, ${provider.hue} 70%, #2b2f33), #1d2024)`,
        } as React.CSSProperties
      }
    >
      {provider.glyph}
    </div>
  );
}

function WebPreview({
  slot,
  provider,
  state,
  mode,
}: {
  slot: SlotId;
  provider: Provider;
  state: SlotState;
  mode: Mode;
}) {
  const compact = (slot === 'C' || slot === 'D') && mode >= 3;
  const src = normalizeProviderUrl(provider.url);

  return (
    <div className="web">
      <div className="web-bar">
        <div className="url">
          <ChevronDown />
          {src}
        </div>
      </div>
      <div className="web-feed">
        {state.status === 'loading' ? (
          <AiTyping provider={provider} />
        ) : (
          state.messages.map((entry) =>
            entry.role === 'user' ? (
              <UserMessage key={entry.id} text={entry.text ?? ''} />
            ) : entry.loading ? (
              <AiTyping key={entry.id} provider={provider} />
            ) : (
              <AiSkeleton key={entry.id} provider={provider} compact={compact} />
            ),
          )
        )}
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="msg user">
      <div className="role">You</div>
      <div className="bubble">{text}</div>
    </div>
  );
}

function AiTyping({ provider }: { provider: Provider }) {
  return (
    <div className="msg ai">
      <ProviderAvatar provider={provider} />
      <div className="role">{provider.name}</div>
      <div className="typing">
        <span className="d" />
        <span className="d" />
        <span className="d" />
      </div>
    </div>
  );
}

function AiSkeleton({ provider, compact }: { provider: Provider; compact: boolean }) {
  return (
    <div className="msg ai">
      <ProviderAvatar provider={provider} />
      <div className="role">{provider.name}</div>
      <div className="body">
        <div className="sk">
          <i className="l" />
          <i className="xl" />
          <i className="m" />
          {!compact && (
            <>
              <i className="xl" />
              <i className="l" />
              <i className="s" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderAvatar({ provider }: { provider: Provider }) {
  if (provider.iconSm || provider.icon) {
    return <img className="msg-avatar" src={provider.iconSm ?? provider.icon} alt="" />;
  }
  return (
    <span className={`msg-avatar glyph ${provider.cjk ? 'cjk' : ''}`} style={{ '--g': provider.hue } as React.CSSProperties}>
      {provider.glyph}
    </span>
  );
}

function EmptySlot() {
  return (
    <div className="empty">
      <div>
        <div className="et">拖入 AI 开始</div>
        <div className="es">从左侧库拖一个 AI 到这里加载</div>
      </div>
    </div>
  );
}
