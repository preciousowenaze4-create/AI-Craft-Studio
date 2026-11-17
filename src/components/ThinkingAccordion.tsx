import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import type { IntentMode } from '../types';

interface ThinkingAccordionProps {
  thinkContent: string;
  isThinking: boolean;
  durationSec?: number;
  detectedIntent: IntentMode | null;
}

const INTENT_LABELS: Record<IntentMode, string> = {
  CASUAL_CHAT: 'Casual Chat',
  REALTIME_SEARCH: 'Real-Time Search',
  CODE_DEBUG: 'Code Debug',
  APP_BUILDER: 'App Builder',
};

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = React.memo(
  ({ thinkContent, isThinking, durationSec, detectedIntent }) => {
    const [expanded, setExpanded] = useState(false);

    if (!thinkContent && !isThinking) {
      return null;
    }

    return (
      <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-zinc-800/40 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Brain
              className={`w-4 h-4 shrink-0 ${
                isThinking ? 'text-indigo-400 animate-pulse' : 'text-zinc-400'
              }`}
            />
            <span className="text-xs font-medium text-zinc-200 whitespace-nowrap">
              {isThinking
                ? 'Thinking Process...'
                : `Thought for ${(durationSec ?? 0.4).toFixed(1)}s`}
            </span>
            {detectedIntent && (
              <>
                <span className="text-zinc-600 text-xs" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs text-zinc-400 truncate">
                  {INTENT_LABELS[detectedIntent]}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-zinc-500 shrink-0">
            <span className="hidden sm:inline">
              {expanded ? 'Hide reasoning' : 'View reasoning'}
            </span>
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        </button>

        {expanded && (
          <div className="px-3.5 pb-3 pt-1 border-t border-zinc-800/70 text-xs leading-relaxed text-zinc-400 font-mono whitespace-pre-wrap max-h-72 overflow-y-auto">
            {thinkContent || 'Analyzing prompt intent and constraints...'}
          </div>
        )}
      </div>
    );
  }
);
