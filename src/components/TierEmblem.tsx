import React from 'react';
import type { ModelModeId } from '../types';

export interface TierVisualConfig {
  id: ModelModeId;
  name: string;
  tag: string;
  badgeBg: string;
  badgeBorder: string;
  fillStart: string;
  fillEnd: string;
  accentText: string;
}

export const TIER_VISUALS: Record<ModelModeId, TierVisualConfig> = {
  'deepseek-r1': {
    id: 'deepseek-r1',
    name: 'AI Craft Max',
    tag: 'Flagship',
    badgeBg: 'bg-amber-500/15',
    badgeBorder: 'border-amber-400/50',
    fillStart: '#fbbf24',
    fillEnd: '#d97706',
    accentText: 'text-amber-300',
  },
  'coder-pro': {
    id: 'coder-pro',
    name: 'AI Craft Pro',
    tag: 'Pro Code',
    badgeBg: 'bg-blue-600/20',
    badgeBorder: 'border-blue-500/50',
    fillStart: '#3b82f6',
    fillEnd: '#1d4ed8',
    accentText: 'text-blue-300',
  },
  auto: {
    id: 'auto',
    name: 'AI Craft Studio',
    tag: 'Balanced',
    badgeBg: 'bg-purple-600/20',
    badgeBorder: 'border-purple-500/50',
    fillStart: '#a855f7',
    fillEnd: '#7e22ce',
    accentText: 'text-purple-300',
  },
  searchgpt: {
    id: 'searchgpt',
    name: 'AI Craft Plus',
    tag: 'Live Web',
    badgeBg: 'bg-emerald-500/15',
    badgeBorder: 'border-emerald-400/50',
    fillStart: '#34d399',
    fillEnd: '#059669',
    accentText: 'text-emerald-300',
  },
  'keyless-unlimited': {
    id: 'keyless-unlimited',
    name: 'AI Craft Flash',
    tag: 'Instant',
    badgeBg: 'bg-red-500/15',
    badgeBorder: 'border-red-500/50',
    fillStart: '#f87171',
    fillEnd: '#dc2626',
    accentText: 'text-red-300',
  },
  'local-webgpu': {
    id: 'local-webgpu',
    name: 'AI Craft Mini',
    tag: 'Local',
    badgeBg: 'bg-zinc-950',
    badgeBorder: 'border-zinc-500/60',
    fillStart: '#e4e4e7',
    fillEnd: '#71717a',
    accentText: 'text-zinc-200',
  },
};

export function getTierVisual(mode?: ModelModeId): TierVisualConfig {
  if (mode && TIER_VISUALS[mode]) {
    return TIER_VISUALS[mode];
  }
  return TIER_VISUALS.auto;
}

interface TierEmblemProps {
  mode?: ModelModeId;
  size?: 'xs' | 'sm' | 'md';
  showBadge?: boolean;
}

export const TierEmblem: React.FC<TierEmblemProps> = React.memo(
  ({ mode = 'auto', size = 'sm', showBadge = true }) => {
    const config = getTierVisual(mode);
    const uid = React.useId().replace(/:/g, '');
    const gradId = `a-emblem-grad-${config.id}-${size}-${uid}`;

    const boxCls =
      size === 'xs'
        ? 'w-5 h-5 rounded-md'
        : size === 'md'
          ? 'w-8 h-8 rounded-lg'
          : 'w-6 h-6 rounded-md';

    const svgCls =
      size === 'xs'
        ? 'w-3.5 h-3.5'
        : size === 'md'
          ? 'w-5 h-5'
          : 'w-4 h-4';

    const svg = (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        className={`${svgCls} shrink-0`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="15%" y1="10%" x2="85%" y2="90%">
            <stop offset="0%" stopColor={config.fillStart} />
            <stop offset="100%" stopColor={config.fillEnd} />
          </linearGradient>
        </defs>

        {/* Left towering sharp peak crest with curved inner cutout & spur */}
        <path
          fill={`url(#${gradId})`}
          d="M52 10 L64 28 C58 29 53 33 49 41 L51 43 C46 47 41 53 35 61 L27 65 L39 50 L31 54 L11 79 L47 21 L52 10 Z"
        />
        {/* Crisp left main blade silhouette */}
        <path
          fill={`url(#${gradId})`}
          d="M52 10 L11 79 L23 64 L32 62 L27 68 L45 45 C42 40 45 31 52 29 L62 29 L52 10 Z"
        />

        {/* Right sharp wing blade with beveled foot */}
        <path
          fill={`url(#${gradId})`}
          d="M71 23 L91 81 L83 71 L80 73 L64 42 L57 44 L69 31 L71 23 Z"
        />

        {/* Inner nested geometric "A" chevron with crisp center diamond cutout */}
        <path
          fill={`url(#${gradId})`}
          fillRule="evenodd"
          d="M52 40 L83 86 L67 68 L61 60 L52 70 L43 60 L37 68 L21 86 L52 40 Z M52 49 L46 57 L52 64 L58 57 L52 49 Z"
        />
      </svg>
    );

    if (!showBadge) {
      return svg;
    }

    return (
      <span
        className={`${boxCls} inline-flex items-center justify-center border ${config.badgeBg} ${config.badgeBorder} shrink-0`}
      >
        {svg}
      </span>
    );
  }
);
