import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Download,
  Edit2,
  ExternalLink,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatSession, PersonaRule } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  chats: ChatSession[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  personaRules: PersonaRule[];
  onAddRule: (rule: Omit<PersonaRule, 'id' | 'createdAt'>) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  activeTab: 'chats' | 'trainer' | 'resources';
  onTabChange: (tab: 'chats' | 'trainer' | 'resources') => void;
}

const LEARNING_DIRECTORY = [
  {
    name: 'Pollinations Free Keyless AI Docs',
    url: 'https://pollinations.ai',
    category: 'Keyless AI Inference',
  },
  {
    name: 'Free Public APIs Directory',
    url: 'https://github.com/public-apis/public-apis',
    category: 'Weather, Crypto, News, Science',
  },
  {
    name: 'MDN Web Docs',
    url: 'https://developer.mozilla.org',
    category: 'HTML, CSS, JavaScript Reference',
  },
  {
    name: 'React Official Documentation',
    url: 'https://react.dev',
    category: 'UI Architecture & Hooks',
  },
  {
    name: 'Tailwind CSS Utility Reference',
    url: 'https://tailwindcss.com/docs',
    category: 'Styling & Design System',
  },
  {
    name: 'FreeCodeCamp Full-Stack Curriculum',
    url: 'https://www.freecodecamp.org',
    category: 'Full-Stack Engineering',
  },
  {
    name: 'Wikipedia Live Open Knowledge API',
    url: 'https://en.wikipedia.org',
    category: 'Open Encyclopedia & REST API',
  },
  {
    name: 'Hugging Face Open Models Hub',
    url: 'https://huggingface.co/models',
    category: 'Open-Weight & WebGPU Models',
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
  personaRules,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  activeTab,
  onTabChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Trainer form state
  const [ruleType, setRuleType] = useState<'rule' | 'fact' | 'qa'>('rule');
  const [ruleLabel, setRuleLabel] = useState('');
  const [ruleContent, setRuleContent] = useState('');
  const [ruleAnswer, setRuleAnswer] = useState('');

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [chats, searchQuery]);

  const handleExportChat = (chat: ChatSession, format: 'json' | 'md') => {
    const content =
      format === 'json'
        ? JSON.stringify(chat, null, 2)
        : `# ${chat.title}\n\n` +
          chat.messages
            .map(
              (m) =>
                `### ${m.role === 'user' ? 'User' : 'AI Craft Studio'}\n\n${m.content}\n`
            )
            .join('\n---\n\n');

    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = chat.title.replace(/[^a-z0-9-_]/gi, '_').slice(0, 40) || 'chat';
    a.download = `${safeTitle}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleContent.trim()) return;
    onAddRule({
      type: ruleType,
      label: ruleLabel.trim() || (ruleType === 'qa' ? 'Q&A Pair' : 'Custom Rule'),
      content: ruleContent.trim(),
      answer: ruleType === 'qa' ? ruleAnswer.trim() : undefined,
      enabled: true,
    });
    setRuleLabel('');
    setRuleContent('');
    setRuleAnswer('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs lg:hidden"
        onClick={onClose}
      />

      <aside className="relative z-50 w-80 max-w-[88vw] h-full bg-[#111114] border-r border-zinc-800 flex flex-col shrink-0">
        {/* Sidebar Header */}
        <div className="pt-[max(1.25rem,env(safe-area-inset-top))] pb-2.5 sm:py-0 sm:h-14 px-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <span className="text-sm font-semibold text-zinc-100 tracking-tight">
            Knowledge & Workspace Hub
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Navigation Tabs */}
        <div className="p-2.5 border-b border-zinc-800/80 shrink-0">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
            <button
              type="button"
              onClick={() => onTabChange('chats')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'chats'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chats</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('trainer')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'trainer'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Trainer</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('resources')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'resources'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Docs</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'chats' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  onNewChat();
                  if (window.innerWidth < 1024) onClose();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Conversation</span>
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search saved chats..."
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-700"
                />
              </div>

              <div className="space-y-1.5">
                {filteredChats.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-6">
                    No matching conversations found.
                  </p>
                ) : (
                  filteredChats.map((chat) => {
                    const isActive = chat.id === activeChatId;
                    const isRenaming = renamingId === chat.id;
                    return (
                      <div
                        key={chat.id}
                        className={`group rounded-xl border p-2.5 transition-colors ${
                          isActive
                            ? 'bg-zinc-800/80 border-zinc-700'
                            : 'bg-zinc-900/40 border-zinc-800/60 hover:bg-zinc-900 hover:border-zinc-800'
                        }`}
                      >
                        {isRenaming ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && renameValue.trim()) {
                                  onRenameChat(chat.id, renameValue.trim());
                                  setRenamingId(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingId(null);
                                }
                              }}
                              autoFocus
                              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (renameValue.trim()) {
                                  onRenameChat(chat.id, renameValue.trim());
                                }
                                setRenamingId(null);
                              }}
                              className="p-1 text-emerald-400 hover:bg-zinc-800 rounded cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectChat(chat.id);
                                if (window.innerWidth < 1024) onClose();
                              }}
                              className="w-full text-left cursor-pointer"
                            >
                              <div className="text-xs font-medium text-zinc-200 truncate">
                                {chat.title}
                              </div>
                              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 tabular-nums">
                                <span>{chat.messages.length} msgs</span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {new Date(chat.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </button>

                            <div className="mt-2 pt-1.5 border-t border-zinc-800/70 flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingId(chat.id);
                                  setRenameValue(chat.title);
                                }}
                                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                                title="Rename"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportChat(chat, 'md')}
                                className="px-1.5 py-0.5 rounded text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                                title="Export Markdown"
                              >
                                MD
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportChat(chat, 'json')}
                                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                                title="Export JSON"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteChat(chat.id)}
                                className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 cursor-pointer"
                                title="Delete chat"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'trainer' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-zinc-200">
                  Custom AI Persona & Rules Trainer
                </h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Enabled rules, facts, and Q&A pairs are saved locally and injected
                  into every AI system prompt automatically.
                </p>
              </div>

              <form
                onSubmit={handleCreateRule}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 space-y-2.5"
              >
                <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-zinc-950 border border-zinc-800">
                  {(['rule', 'fact', 'qa'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRuleType(t)}
                      className={`py-1 rounded text-[11px] font-medium cursor-pointer ${
                        ruleType === t
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {t === 'rule' ? 'Rule' : t === 'fact' ? 'Fact' : 'Q&A'}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={ruleLabel}
                  onChange={(e) => setRuleLabel(e.target.value)}
                  placeholder="Label (e.g., Coding Style, Brand Voice)"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                />

                <textarea
                  value={ruleContent}
                  onChange={(e) => setRuleContent(e.target.value)}
                  rows={2}
                  placeholder={
                    ruleType === 'qa'
                      ? 'Example user question...'
                      : 'Instruction or domain fact for the AI...'
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 resize-y"
                />

                {ruleType === 'qa' && (
                  <textarea
                    value={ruleAnswer}
                    onChange={(e) => setRuleAnswer(e.target.value)}
                    rows={2}
                    placeholder="Ideal assistant answer..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 resize-y"
                  />
                )}

                <button
                  type="submit"
                  className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  Add Training Entry
                </button>
              </form>

              <div className="space-y-2">
                {personaRules.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-4">
                    No custom rules yet. Add one above to customize AI behavior.
                  </p>
                ) : (
                  personaRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11px] font-medium text-indigo-300 uppercase">
                            {rule.type}
                          </span>
                          <span className="text-zinc-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs font-medium text-zinc-200 truncate">
                            {rule.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onToggleRule(rule.id)}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                              rule.enabled
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {rule.enabled ? 'Active' : 'Off'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRule(rule.id)}
                            className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer"
                            title="Delete rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-300 leading-snug">
                        {rule.content}
                      </p>
                      {rule.answer && (
                        <p className="text-[11px] text-zinc-400 border-t border-zinc-800/70 pt-1">
                          A: {rule.answer}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'resources' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-zinc-200">
                  Free Developer & Knowledge Directory
                </h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Curated zero-cost APIs, documentation, and open model hubs.
                </p>
              </div>

              <div className="space-y-2">
                {LEARNING_DIRECTORY.map((item) => (
                  <a
                    key={item.url}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 p-3 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-100">
                        {item.name}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      {item.category}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
