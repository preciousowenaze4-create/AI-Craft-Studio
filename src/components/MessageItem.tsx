import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Globe,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ChatMessage } from '../types';
import { parseThinkingContent } from '../utils/streamParser';
import {
  isSpeechSupported,
  stopSpeech,
  subscribeSpeechState,
  toggleMessageSpeech,
} from '../utils/speech';
import { ThinkingAccordion } from './ThinkingAccordion';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
  liveThinkingSeconds?: number;
  onRegenerate?: (messageId: string) => void;
  onEditPrompt?: (messageId: string, newContent: string) => void;
  onExportTableToSheets?: (rows: string[][]) => void;
}

export const MessageItem: React.FC<MessageItemProps> = React.memo(
  ({
    message,
    isStreaming = false,
    liveThinkingSeconds,
    onRegenerate,
    onEditPrompt,
    onExportTableToSheets,
  }) => {
    const [copied, setCopied] = useState(false);
    const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(message.content);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

    const isSpeaking = activeSpeechId === message.id;
    const isSpeakingRef = useRef(false);
    isSpeakingRef.current = isSpeaking;

    useEffect(() => {
      return subscribeSpeechState(setActiveSpeechId);
    }, []);

    useEffect(() => {
      return () => {
        if (isSpeakingRef.current) {
          stopSpeech();
        }
      };
    }, []);

    const parsed = useMemo(() => {
      if (message.role === 'user') return null;
      return parseThinkingContent(message.content);
    }, [message.content, message.role]);

    const handleCopy = async () => {
      const textToCopy =
        message.role === 'assistant' && parsed
          ? parsed.answerContent || message.content
          : message.content;
      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // ignore
      }
    };

    const handleToggleSpeech = () => {
      if (!isSpeechSupported()) return;
      const text =
        message.role === 'assistant' && parsed
          ? parsed.answerContent || message.content
          : message.content;
      toggleMessageSpeech(message.id, text);
    };

    const handleSaveEdit = () => {
      const trimmed = editText.trim();
      if (!trimmed && (!message.images || message.images.length === 0)) return;
      setIsEditing(false);
      onEditPrompt?.(message.id, trimmed);
    };

    if (message.role === 'user') {
      const hasImages = Boolean(message.images && message.images.length > 0);
      return (
        <div className="flex justify-end group">
          <div className="max-w-[88%] sm:max-w-[78%] space-y-1.5">
            {isEditing ? (
              <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-3 space-y-2.5 min-w-[260px] sm:min-w-[400px]">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-[15px] text-zinc-100 focus:outline-none focus:border-indigo-500 resize-y"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setEditText(message.content);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                  >
                    Save & Resend
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-[#18181b] border border-zinc-800 px-4 py-3 text-[15px] leading-relaxed text-zinc-100 space-y-2.5">
                {hasImages && (
                  <div className="flex flex-wrap gap-2">
                    {message.images!.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => setPreviewImageUrl(img.dataUrl)}
                        className="group/img relative overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                        title={`View ${img.name}`}
                      >
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          className="max-h-48 max-w-[240px] object-cover transition-transform duration-150 group-hover/img:scale-[1.02]"
                        />
                      </button>
                    ))}
                  </div>
                )}
                {message.content && (
                  <div className="whitespace-pre-wrap break-words">
                    {message.content}
                  </div>
                )}
              </div>
            )}

            {previewImageUrl && (
              <div
                className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setPreviewImageUrl(null)}
              >
                <button
                  type="button"
                  onClick={() => setPreviewImageUrl(null)}
                  className="fixed top-4 right-4 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 hover:text-white cursor-pointer"
                  aria-label="Close image preview"
                >
                  <X className="w-5 h-5" />
                </button>
                <img
                  src={previewImageUrl}
                  alt="Uploaded preview"
                  className="max-w-full max-h-[88dvh] rounded-xl border border-zinc-800 object-contain shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            {!isEditing && (
              <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70 transition-colors cursor-pointer"
                  title="Copy prompt"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                {onEditPrompt && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(message.content);
                      setIsEditing(true);
                    }}
                    className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70 transition-colors cursor-pointer"
                    title="Edit prompt"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    const timeLabel = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(message.createdAt));

    return (
      <div className="flex justify-start group">
        <div className="w-full max-w-4xl space-y-2">
          {/* Live Source Citations above AI response */}
          {message.sources && message.sources.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Live Web Sources ({message.sources.length})</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {message.sources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col justify-between gap-1 p-2.5 rounded-lg border border-zinc-800/90 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-200 line-clamp-1">
                        {src.title}
                      </span>
                      <ExternalLink className="w-3 h-3 text-zinc-500 shrink-0 mt-0.5" />
                    </div>
                    <p className="text-[11px] text-zinc-400 line-clamp-2 leading-snug">
                      {src.snippet}
                    </p>
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                      <span>{src.provider}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Collapsible Thinking Process Accordion */}
          {parsed && (
            <ThinkingAccordion
              thinkContent={parsed.thinkContent}
              isThinking={isStreaming && parsed.isThinking}
              durationSec={
                isStreaming && parsed.isThinking
                  ? liveThinkingSeconds
                  : message.thinkingDurationSec
              }
              detectedIntent={parsed.detectedIntent}
            />
          )}

          {/* Main Answer */}
          {message.isError ? (
            <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {message.content}
            </div>
          ) : parsed?.answerContent ? (
            <div className="text-zinc-100">
              <MarkdownRenderer
                content={parsed.answerContent}
                onExportTableToSheets={onExportTableToSheets}
              />
            </div>
          ) : isStreaming && !parsed?.isThinking ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-1">
              <span>Generating response...</span>
            </div>
          ) : null}

          {/* Rich Message Toolbar & Unboxed Metadata */}
          {!isStreaming && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 transition-colors cursor-pointer whitespace-nowrap"
                  title="Copy response text"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                {onRegenerate && (
                  <button
                    type="button"
                    onClick={() => onRegenerate(message.id)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 transition-colors cursor-pointer whitespace-nowrap"
                    title="Regenerate response"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Regenerate</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  aria-pressed={isSpeaking}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded-md text-xs transition-colors cursor-pointer whitespace-nowrap ${
                    isSpeaking
                      ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 border border-transparent'
                  }`}
                  title={isSpeaking ? 'Stop reading aloud' : 'Read aloud'}
                >
                  {isSpeaking ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="font-medium text-indigo-300">Stop</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Speak</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-zinc-500 tabular-nums">
                {message.engineUsed && <span>{message.engineUsed}</span>}
                {message.engineUsed && <span aria-hidden="true">·</span>}
                <span>{timeLabel}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);
