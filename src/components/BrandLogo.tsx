import React from 'react';

interface BrandLogoProps {
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = React.memo(
  ({ className = 'w-8 h-8' }) => {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="aiCraftBrainStroke"
            x1="10"
            y1="12"
            x2="54"
            y2="54"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <radialGradient
            id="aiCraftCoreGlow"
            cx="32"
            cy="34"
            r="16"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* System Pane Frame */}
        <rect
          x="2.5"
          y="2.5"
          width="59"
          height="59"
          rx="14"
          fill="#12131c"
          stroke="#3f3f46"
          strokeWidth="1.75"
        />

        {/* Intricate Neural System Grid */}
        <g stroke="#272a3a" strokeWidth="0.75">
          <line x1="15" y1="13" x2="15" y2="55" />
          <line x1="23.5" y1="13" x2="23.5" y2="55" />
          <line x1="32" y1="13" x2="32" y2="55" />
          <line x1="40.5" y1="13" x2="40.5" y2="55" />
          <line x1="49" y1="13" x2="49" y2="55" />
          <line x1="8" y1="21" x2="56" y2="21" />
          <line x1="8" y1="29.5" x2="56" y2="29.5" />
          <line x1="8" y1="38" x2="56" y2="38" />
          <line x1="8" y1="46.5" x2="56" y2="46.5" />
        </g>

        {/* System Pane Header */}
        <line x1="3" y1="12.5" x2="61" y2="12.5" stroke="#3f3f46" strokeWidth="1.1" />
        <circle cx="10" cy="7.5" r="1.5" fill="#38bdf8" />
        <circle cx="15" cy="7.5" r="1.5" fill="#818cf8" />
        <circle cx="20" cy="7.5" r="1.5" fill="#34d399" />

        {/* Central Core Aura */}
        <circle cx="32" cy="34" r="16" fill="url(#aiCraftCoreGlow)" />

        {/* Bold Left Brain Hemisphere */}
        <path
          d="M30 18 C24.8 17.4, 20 19.8, 17.8 24 C14.2 24.6, 11.8 28.2, 12.4 32 C10.4 35, 11.2 39.6, 14.2 42.2 C14.2 46.4, 17.6 50.2, 22 50.6 C24.8 52.6, 28.2 52.4, 30 50.4 Z"
          fill="#111626"
          stroke="url(#aiCraftBrainStroke)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M17.8 26.8 H23.8 L26.4 29.4 M14.8 34.4 H21.6 L24.6 31.4 M18.4 43.2 H24.6 L27.2 40.6"
          stroke="#38bdf8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17.8" cy="26.8" r="1.5" fill="#38bdf8" />
        <circle cx="14.8" cy="34.4" r="1.5" fill="#818cf8" />
        <circle cx="18.4" cy="43.2" r="1.5" fill="#34d399" />

        {/* Bold Right Brain Hemisphere */}
        <path
          d="M34 18 C39.2 17.4, 44 19.8, 46.2 24 C49.8 24.6, 52.2 28.2, 51.6 32 C53.6 35, 52.8 39.6, 49.8 42.2 C49.8 46.4, 46.4 50.2, 42 50.6 C39.2 52.6, 35.8 52.4, 34 50.4 Z"
          fill="#111626"
          stroke="url(#aiCraftBrainStroke)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M46.2 26.8 H40.2 L37.6 29.4 M49.2 34.4 H42.4 L39.4 31.4 M45.6 43.2 H39.4 L36.8 40.6"
          stroke="#818cf8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="46.2" cy="26.8" r="1.5" fill="#818cf8" />
        <circle cx="49.2" cy="34.4" r="1.5" fill="#34d399" />
        <circle cx="45.6" cy="43.2" r="1.5" fill="#38bdf8" />

        {/* Central AI Core Spark */}
        <path
          d="M32 27.6 L33.8 32.2 L38.4 34 L33.8 35.8 L32 40.4 L30.2 35.8 L25.6 34 L30.2 32.2 Z"
          fill="#ffffff"
        />
        <circle cx="32" cy="34" r="1.7" fill="#38bdf8" />
      </svg>
    );
  }
);
