import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-[#18181b] hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        title="Install AI Craft Studio App"
      >
        <Download className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span className="hidden md:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-[#18181b] hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title="Add AI Craft Studio to iPhone Home Screen"
        >
          <Share className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="hidden sm:inline">Add App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#18181b] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">
                  Add AI Craft Studio to Home Screen
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
                  aria-label="Close install instructions"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-xs text-zinc-300 leading-relaxed list-decimal pl-4">
                <li>
                  Tap the <strong className="text-zinc-100">Share</strong> icon in
                  Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and tap{' '}
                  <strong className="text-zinc-100">Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-zinc-100">Add</strong> to launch
                  full-screen without Safari browser bars.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
