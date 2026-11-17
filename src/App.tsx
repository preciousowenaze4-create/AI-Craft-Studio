import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ChevronDown,
  Code2,
  Cpu,
  FileSpreadsheet,
  Globe,
  MapPin,
  Menu,
  Plus,
  Send,
  Sparkles,
  Square,
  Terminal,
} from 'lucide-react';
import type {
  ChatMessage,
  ChatSession,
  LiveSource,
  LocalModelProgress,
  ModelModeId,
  PersonaRule,
} from './types';
import { MODEL_MODES, runChatStream } from './services/aiRouter';
import { parseThinkingContent } from './utils/streamParser';
import { MessageItem } from './components/MessageItem';
import { Sidebar } from './components/Sidebar';
import { MapsExplorerModal } from './components/MapsExplorerModal';
import { SheetsWorkspaceModal } from './components/SheetsWorkspaceModal';
import { BrandLogo } from './components/BrandLogo';
import { PWAInstallButton } from './components/PWAInstallButton';

const CHATS_STORAGE_KEY = 'vektor_chats_v1';
const RULES_STORAGE_KEY = 'vektor_persona_rules_v1';
const MODE_STORAGE_KEY = 'vektor_model_mode_v1';

function createNewChat(): ChatSession {
  const now = Date.now();
  return {
    id: `chat_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Conversation',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function loadInitialChats(): ChatSession[] {
  try {
    const raw = localStorage.getItem(CHATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupted storage
  }
  return [createNewChat()];
}

function loadInitialRules(): PersonaRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersonaRule[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

const QUICK_CHIPS = [
  {
    id: 'build',
    label: 'Build a Full Web App',
    prompt:
      'Build a complete, interactive Kanban task board web app in a single HTML file with drag-and-drop columns, localStorage persistence, and a sleek dark UI.',
  },
  {
    id: 'search',
    label: 'Search Live News & Facts',
    prompt:
      "What are today's top technology and AI headlines? Search live sources and summarize with clickable links.",
  },
  {
    id: 'debug',
    label: 'Explain & Debug Code',
    prompt:
      'Explain common React useEffect race conditions when fetching streaming APIs and show the cleanest AbortController pattern to prevent stale state updates.',
  },
  {
    id: 'train',
    label: 'Teach AI Custom Rules',
    prompt: '',
  },
];

export default function App() {
  const [chats, setChats] = useState<ChatSession[]>(loadInitialChats);
  const [activeChatId, setActiveChatId] = useState<string>(() => {
    const loaded = loadInitialChats();
    return loaded[0].id;
  });
  const [personaRules, setPersonaRules] = useState<PersonaRule[]>(loadInitialRules);
  const [modelMode, setModelMode] = useState<ModelModeId>(() => {
    const saved = localStorage.getItem(MODE_STORAGE_KEY) as ModelModeId | null;
    return saved && MODEL_MODES.some((m) => m.id === saved) ? saved : 'auto';
  });
  const [liveSearchEnabled, setLiveSearchEnabled] = useState(true);

  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [liveThinkingSec, setLiveThinkingSec] = useState(0);
  const [localProgress, setLocalProgress] = useState<LocalModelProgress>({
    status: 'idle',
    progress: 0,
    text: '',
  });

  // Workspace UI modals & drawers
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'trainer' | 'resources'>(
    'chats'
  );
  const [mapsOpen, setMapsOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [pendingExportRows, setPendingExportRows] = useState<string[][] | null>(null);
  const [pendingExportTitle, setPendingExportTitle] = useState('AI Craft Studio Export');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  // Google Maps API Key & Case A Quota Banner
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  // Smart auto-scroll lock state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) || chats[0],
    [chats, activeChatId]
  );

  const currentModeOption = useMemo(
    () => MODEL_MODES.find((m) => m.id === modelMode) || MODEL_MODES[0],
    [modelMode]
  );

  // Persist chats, persona rules, and model mode
  useEffect(() => {
    try {
      localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats));
    } catch {
      // ignore quota exceeded
    }
  }, [chats]);

  useEffect(() => {
    try {
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(personaRules));
    } catch {
      // ignore
    }
  }, [personaRules]);

  useEffect(() => {
    localStorage.setItem(MODE_STORAGE_KEY, modelMode);
  }, [modelMode]);

  // Listen for Case A Demo Key quota exceeded event
  useEffect(() => {
    const handler = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Fetch runtime Maps API key if not injected at Vite build time
  useEffect(() => {
    if (mapsApiKey) return;
    fetch('/api/maps/client-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { apiKey?: string } | null) => {
        if (data?.apiKey) setMapsApiKey(data.apiKey);
      })
      .catch(() => {
        // ignore
      });
  }, [mapsApiKey]);

  // Close mode dropdown on outside click
  useEffect(() => {
    if (!modeMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(e.target as Node)
      ) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [modeMenuOpen]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 80;
    userScrolledUpRef.current = !isNearBottom;
    setShowScrollBottom(!isNearBottom);
  }, []);

  const handleNewChat = useCallback(() => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
    }
    const fresh = createNewChat();
    setChats((prev) => [fresh, ...prev]);
    setActiveChatId(fresh.id);
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
  }, [isStreaming]);

  const executePrompt = useCallback(
    async (
      targetChatId: string,
      historyMessages: ChatMessage[],
      assistantMsgId: string
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);
      setStreamingMsgId(assistantMsgId);
      setLiveThinkingSec(0);
      userScrolledUpRef.current = false;

      const startTime = performance.now();
      let thinkEndTime: number | null = null;
      let accumulated = '';
      let sourcesList: LiveSource[] = [];

      const timerInterval = window.setInterval(() => {
        if (thinkEndTime === null) {
          setLiveThinkingSec((performance.now() - startTime) / 1000);
        }
      }, 100);

      try {
        const finalEngine = await runChatStream({
          modelMode,
          history: historyMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          liveSearchEnabled,
          personaRules,
          onSources: (sources) => {
            sourcesList = sources;
            setChats((prev) =>
              prev.map((c) =>
                c.id === targetChatId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, sources } : m
                      ),
                    }
                  : c
              )
            );
          },
          onToken: (token, engine) => {
            accumulated += token;
            const parsed = parseThinkingContent(accumulated);
            if (!parsed.isThinking && thinkEndTime === null && parsed.thinkContent) {
              thinkEndTime = performance.now();
            }

            const duration =
              thinkEndTime !== null
                ? (thinkEndTime - startTime) / 1000
                : (performance.now() - startTime) / 1000;

            setChats((prev) =>
              prev.map((c) =>
                c.id === targetChatId
                  ? {
                      ...c,
                      updatedAt: Date.now(),
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              content: accumulated,
                              engineUsed: engine,
                              thinkingDurationSec: duration,
                              sources: sourcesList,
                            }
                          : m
                      ),
                    }
                  : c
              )
            );

            if (!userScrolledUpRef.current) {
              requestAnimationFrame(() => scrollToBottom(false));
            }
          },
          onLocalProgress: setLocalProgress,
          signal: controller.signal,
        });

        const totalThinkDuration =
          thinkEndTime !== null
            ? (thinkEndTime - startTime) / 1000
            : (performance.now() - startTime) / 1000;

        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          engineUsed: finalEngine,
                          thinkingDurationSec: totalThinkDuration,
                        }
                      : m
                  ),
                }
              : c
          )
        );
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        const message =
          err instanceof Error ? err.message : 'Unable to complete AI request.';
        setChats((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: message, isError: true }
                      : m
                  ),
                }
              : c
          )
        );
      } finally {
        clearInterval(timerInterval);
        setIsStreaming(false);
        setStreamingMsgId(null);
        abortControllerRef.current = null;
      }
    },
    [modelMode, liveSearchEnabled, personaRules, scrollToBottom]
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? inputValue).trim();
      if (!text || isStreaming) return;

      if (!overrideText) {
        setInputValue('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: `msg_u_${now}`,
        role: 'user',
        content: text,
        createdAt: now,
      };
      const assistantMsg: ChatMessage = {
        id: `msg_a_${now + 1}`,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
        modelMode,
      };

      const targetId = activeChat.id;
      const updatedHistory = [...activeChat.messages, userMsg];
      const nextTitle =
        activeChat.messages.length === 0
          ? text.slice(0, 46) + (text.length > 46 ? '...' : '')
          : activeChat.title;

      setChats((prev) =>
        prev.map((c) =>
          c.id === targetId
            ? {
                ...c,
                title: nextTitle,
                updatedAt: now,
                messages: [...updatedHistory, assistantMsg],
              }
            : c
        )
      );

      requestAnimationFrame(() => scrollToBottom(true));
      await executePrompt(targetId, updatedHistory, assistantMsg.id);
    },
    [inputValue, isStreaming, activeChat, modelMode, executePrompt, scrollToBottom]
  );

  const handleRegenerate = useCallback(
    async (assistantMsgId: string) => {
      if (isStreaming) return;
      const idx = activeChat.messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return;

      const historyUpToUser = activeChat.messages.slice(0, idx);
      const freshAssistant: ChatMessage = {
        id: `msg_a_${Date.now()}`,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        modelMode,
      };

      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChat.id
            ? {
                ...c,
                messages: [...historyUpToUser, freshAssistant],
              }
            : c
        )
      );

      await executePrompt(activeChat.id, historyUpToUser, freshAssistant.id);
    },
    [isStreaming, activeChat, modelMode, executePrompt]
  );

  const handleEditPrompt = useCallback(
    async (userMsgId: string, newContent: string) => {
      if (isStreaming) return;
      const idx = activeChat.messages.findIndex((m) => m.id === userMsgId);
      if (idx === -1) return;

      const prior = activeChat.messages.slice(0, idx);
      const updatedUser: ChatMessage = {
        ...activeChat.messages[idx],
        content: newContent,
      };
      const freshAssistant: ChatMessage = {
        id: `msg_a_${Date.now()}`,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        modelMode,
      };

      const newHistory = [...prior, updatedUser];
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChat.id
            ? {
                ...c,
                messages: [...newHistory, freshAssistant],
              }
            : c
        )
      );

      await executePrompt(activeChat.id, newHistory, freshAssistant.id);
    },
    [isStreaming, activeChat, modelMode, executePrompt]
  );

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setStreamingMsgId(null);
  };

  const handleChipClick = (chip: (typeof QUICK_CHIPS)[number]) => {
    if (chip.id === 'train') {
      setSidebarTab('trainer');
      setSidebarOpen(true);
      return;
    }
    if (chip.id === 'build') {
      setModelMode('coder-pro');
    } else if (chip.id === 'search') {
      setModelMode('searchgpt');
      setLiveSearchEnabled(true);
    }
    setInputValue(chip.prompt);
    textareaRef.current?.focus();
  };

  const handleOpenTableExport = useCallback((rows: string[][]) => {
    setPendingExportRows(rows);
    setPendingExportTitle('AI Craft Table Export');
    setSheetsOpen(true);
  }, []);

  const handleOpenChatExportToSheets = useCallback(() => {
    if (activeChat.messages.length === 0) {
      setPendingExportRows(null);
    } else {
      const rows: string[][] = [
        ['Timestamp', 'Role', 'Engine', 'Content'],
        ...activeChat.messages.map((m) => [
          new Date(m.createdAt).toISOString(),
          m.role,
          m.engineUsed || '',
          m.content.slice(0, 4000),
        ]),
      ];
      setPendingExportRows(rows);
      setPendingExportTitle(activeChat.title || 'AI Craft Chat Export');
    }
    setSheetsOpen(true);
  }, [activeChat]);

  return (
    <div className="h-[100dvh] w-full overflow-hidden flex flex-col bg-[#09090b] text-zinc-100">
      {/* Case A Demo Key Quota Exceeded Banner (Required when quota limit triggers) */}
      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm shrink-0">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Header (Shifted down on mobile with iPhone safe-area top padding for thumb reachability) */}
      <header className="shrink-0 border-b border-zinc-800/80 bg-[#09090b]/95 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-2.5 sm:py-0 sm:h-14 px-3 sm:px-4 flex items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 flex items-center justify-center p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors cursor-pointer shrink-0"
            aria-label="Open workspace sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <BrandLogo className="w-8 h-8 shrink-0" />
            <span className="text-sm sm:text-base font-bold tracking-tight text-zinc-100 whitespace-nowrap truncate">
              AI Craft Studio
            </span>
          </div>
        </div>

        {/* Center/Right Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Model & Mode Switcher */}
          <div className="relative" ref={modeMenuRef}>
            <button
              type="button"
              onClick={() => setModeMenuOpen((prev) => !prev)}
              className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg border border-zinc-800 bg-[#18181b] hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="max-w-[96px] sm:max-w-[200px] truncate">
                {currentModeOption.shortLabel}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            </button>

            {modeMenuOpen && (
              <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl border border-zinc-800 bg-[#18181b] shadow-xl p-1.5 z-50">
                {MODEL_MODES.map((opt) => {
                  const active = opt.id === modelMode;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setModelMode(opt.id);
                        setModeMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                        active
                          ? 'bg-indigo-600/15 border border-indigo-500/30'
                          : 'hover:bg-zinc-800/70 border border-transparent'
                      }`}
                    >
                      <div className="text-xs font-semibold text-zinc-100">
                        {opt.label}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        {opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMapsOpen(true)}
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-[#18181b] hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Google Maps Explorer & Location Grounding"
          >
            <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="hidden md:inline">Maps</span>
          </button>

          <button
            type="button"
            onClick={handleOpenChatExportToSheets}
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-[#18181b] hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Google Sheets Workspace Sync"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden md:inline">Sheets</span>
          </button>

          <PWAInstallButton />

          <button
            type="button"
            onClick={handleNewChat}
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Start new conversation"
          >
            <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </header>

      {/* Local Browser AI Download Progress Bar */}
      {modelMode === 'local-webgpu' && localProgress.status === 'loading' && (
        <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/70 shrink-0">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-300 truncate">{localProgress.text}</span>
            <span className="font-mono tabular-nums text-indigo-300 shrink-0">
              {localProgress.progress}%
            </span>
          </div>
          <div className="max-w-4xl mx-auto mt-1.5 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-150"
              style={{ width: `${localProgress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Scrollable Chat Viewport */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6"
      >
        <div className="max-w-4xl mx-auto space-y-6">
          {activeChat.messages.length === 0 ? (
            <div className="min-h-[54dvh] flex flex-col items-center justify-center text-center px-2 py-8 space-y-6">
              <div className="space-y-2.5 max-w-2xl">
                <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-100 text-balance">
                  Keyless AI Chat, Live Research & App Builder
                </h1>
                <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
                  Stream step-by-step reasoning, search live web sources, preview
                  built apps in a live sandbox, explore Google Maps grounding, or
                  run Qwen2.5-Coder locally in your browser.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl text-left">
                <div className="rounded-xl border border-zinc-800 bg-[#18181b]/70 p-4 space-y-1.5">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-xs font-semibold text-zinc-100">
                    Multi-Tier Keyless Routing
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Zero API keys required. Automatic failover across cloud
                    endpoints plus optional offline WebGPU inference.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-[#18181b]/70 p-4 space-y-1.5">
                  <Code2 className="w-4 h-4 text-sky-400" />
                  <h2 className="text-xs font-semibold text-zinc-100">
                    Live App Sandbox
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Run generated HTML, CSS, JavaScript, and React components
                    directly inside the chat with one click.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-[#18181b]/70 p-4 space-y-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-xs font-semibold text-zinc-100">
                    Real-Time Grounding & Sync
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    DuckDuckGo, Wikipedia, Google Search & Maps grounding, plus
                    direct Google Sheets read and export.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            activeChat.messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && msg.id === streamingMsgId}
                liveThinkingSeconds={
                  isStreaming && msg.id === streamingMsgId
                    ? liveThinkingSec
                    : undefined
                }
                onRegenerate={
                  msg.role === 'assistant' ? handleRegenerate : undefined
                }
                onEditPrompt={msg.role === 'user' ? handleEditPrompt : undefined}
                onExportTableToSheets={handleOpenTableExport}
              />
            ))
          )}
        </div>
      </main>

      {/* Scroll-to-bottom button when user scrolls up */}
      {showScrollBottom && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              userScrolledUpRef.current = false;
              scrollToBottom(true);
              setShowScrollBottom(false);
            }}
            className="absolute -top-12 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-700 bg-[#18181b] text-xs font-medium text-zinc-200 shadow-lg hover:bg-zinc-800 cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Scroll to bottom</span>
          </button>
        </div>
      )}

      {/* Bottom Quick Chips & Floating Input Bar */}
      <footer className="shrink-0 border-t border-zinc-800/80 bg-[#09090b] px-3 sm:px-6 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto space-y-2.5">
          {/* Quick-Start Action Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleChipClick(chip)}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-[#18181b] hover:border-zinc-700 hover:bg-zinc-800/80 text-xs font-medium text-zinc-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Input Composer */}
          <div className="rounded-2xl border border-zinc-800 bg-[#18181b] focus-within:border-zinc-700 transition-colors p-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Ask anything, search live facts, or describe an app to build..."
              className="w-full bg-transparent px-2.5 py-1.5 text-[16px] sm:text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none max-h-40 leading-relaxed"
            />

            <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLiveSearchEnabled((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    liveSearchEnabled
                      ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Live Web Search: {liveSearchEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStopStreaming}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-xs font-semibold text-red-300 cursor-pointer whitespace-nowrap"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Collapsible Knowledge & Training Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        chats={chats}
        activeChatId={activeChat.id}
        onSelectChat={(id) => setActiveChatId(id)}
        onNewChat={handleNewChat}
        onRenameChat={(id, title) =>
          setChats((prev) =>
            prev.map((c) => (c.id === id ? { ...c, title } : c))
          )
        }
        onDeleteChat={(id) => {
          setChats((prev) => {
            const remaining = prev.filter((c) => c.id !== id);
            if (remaining.length === 0) {
              const fresh = createNewChat();
              setActiveChatId(fresh.id);
              return [fresh];
            }
            if (id === activeChatId) {
              setActiveChatId(remaining[0].id);
            }
            return remaining;
          });
        }}
        personaRules={personaRules}
        onAddRule={(rule) =>
          setPersonaRules((prev) => [
            {
              ...rule,
              id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              createdAt: Date.now(),
            },
            ...prev,
          ])
        }
        onToggleRule={(id) =>
          setPersonaRules((prev) =>
            prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
          )
        }
        onDeleteRule={(id) =>
          setPersonaRules((prev) => prev.filter((r) => r.id !== id))
        }
        activeTab={sidebarTab}
        onTabChange={setSidebarTab}
      />

      {/* Interactive Google Maps Explorer & Grounding Modal */}
      <MapsExplorerModal
        isOpen={mapsOpen}
        onClose={() => setMapsOpen(false)}
        apiKey={mapsApiKey}
        onSendPlacesToChat={(summary) => {
          setInputValue(summary);
          textareaRef.current?.focus();
        }}
        onExportPlacesToSheets={(rows) => {
          setMapsOpen(false);
          setPendingExportRows(rows);
          setPendingExportTitle('Google Maps Places Export');
          setSheetsOpen(true);
        }}
      />

      {/* Google Sheets Workspace Sync Modal */}
      <SheetsWorkspaceModal
        isOpen={sheetsOpen}
        onClose={() => setSheetsOpen(false)}
        pendingExportRows={pendingExportRows}
        pendingExportTitle={pendingExportTitle}
        onInjectSheetDataToChat={(text) => {
          setInputValue(text);
          textareaRef.current?.focus();
        }}
      />
    </div>
  );
}
