import React, { useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  Play,
  Square,
} from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

const PREVIEWABLE_LANGS = new Set([
  'html',
  'htm',
  'svg',
  'jsx',
  'tsx',
  'javascript',
  'js',
  'css',
]);

function getFileExtension(lang: string): string {
  const map: Record<string, string> = {
    html: 'html',
    htm: 'html',
    javascript: 'js',
    js: 'js',
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    jsx: 'jsx',
    css: 'css',
    json: 'json',
    python: 'py',
    py: 'py',
    bash: 'sh',
    sh: 'sh',
    sql: 'sql',
    svg: 'svg',
    markdown: 'md',
    md: 'md',
  };
  return map[lang.toLowerCase()] || 'txt';
}

function buildSandboxDocument(code: string, lang: string): string {
  const lower = lang.toLowerCase();
  if (lower === 'html' || lower === 'htm') {
    return code;
  }
  if (lower === 'svg') {
    return `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#09090b;color:#f4f4f5;">${code}</body></html>`;
  }
  if (lower === 'css') {
    return `<!doctype html><html><head><style>${code}</style></head><body style="padding:24px;font-family:sans-serif;"><div class="preview-card"><h1>CSS Preview</h1><p>Styled element preview</p><button>Action Button</button></div></body></html>`;
  }
  if (lower === 'jsx' || lower === 'tsx') {
    const cleaned = code
      .replace(/^\s*import\s+.*?;\s*$/gm, '')
      .replace(/export\s+default\s+function\s+/g, 'function ')
      .replace(/export\s+default\s+/g, 'const App = ');
    const hasApp = /function\s+App\b|const\s+App\b/.test(cleaned);
    return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>body{margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useMemo, useRef, useCallback } = React;
    try {
      ${cleaned}
      const RootComp = ${hasApp ? 'App' : '() => React.createElement("pre", {style:{padding:"16px"}}, "Define function App() to render React preview.")'};
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(RootComp));
    } catch (err) {
      document.getElementById('root').innerHTML = '<pre style="color:#f87171;padding:16px;white-space:pre-wrap;">' + err.message + '</pre>';
    }
  </script>
</body>
</html>`;
  }

  // Plain JS
  return `<!doctype html>
<html>
<head><style>body{margin:0;padding:16px;background:#09090b;color:#e4e4e7;font-family:monospace;font-size:13px;}</style></head>
<body>
  <div id="app"></div>
  <pre id="console-out"></pre>
  <script>
    const out = document.getElementById('console-out');
    const origLog = console.log;
    console.log = (...args) => {
      origLog(...args);
      out.textContent += args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\\n';
    };
    try {
      ${code}
    } catch (e) {
      out.style.color = '#f87171';
      out.textContent = e.message;
    }
  </script>
</body>
</html>`;
}

function tokenizeLine(line: string): Array<{ text: string; cls: string }> {
  const tokens: Array<{ text: string; cls: string }> = [];
  const regex =
    /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|import|export|from|default|async|await|try|catch|throw|new|class|interface|type|extends|implements|true|false|null|undefined|def|elif|pass|in|not|and|or)\b|\b\d+(?:\.\d+)?\b|<\/?[a-zA-Z0-9-]+|\/>|>)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), cls: 'text-zinc-200' });
    }
    const token = match[0];
    let cls = 'text-zinc-200';
    if (token.startsWith('//') || token.startsWith('#') || token.startsWith('/*')) {
      cls = 'text-zinc-500 italic';
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      cls = 'text-emerald-300';
    } else if (/^\d/.test(token)) {
      cls = 'text-amber-300';
    } else if (token.startsWith('<') || token === '/>' || token === '>') {
      cls = 'text-sky-300';
    } else {
      cls = 'text-indigo-300 font-medium';
    }
    tokens.push({ text: token, cls });
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), cls: 'text-zinc-200' });
  }
  return tokens;
}

export const CodeBlock: React.FC<CodeBlockProps> = React.memo(
  ({ code, language = 'text' }) => {
    const [copied, setCopied] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const normalizedLang = language.toLowerCase() || 'text';
    const isPreviewable = PREVIEWABLE_LANGS.has(normalizedLang);
    const lines = useMemo(() => code.split('\n'), [code]);

    const sandboxHtml = useMemo(() => {
      if (!showPreview) return '';
      return buildSandboxDocument(code, normalizedLang);
    }, [code, normalizedLang, showPreview]);

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // Fallback copy ignored
      }
    };

    const handleDownload = () => {
      const ext = getFileExtension(normalizedLang);
      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vektor-output.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="my-3 rounded-xl border border-zinc-800 bg-[#111114] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2 border-b border-zinc-800/90 bg-zinc-900/70">
          <div className="flex items-center gap-2 text-xs text-zinc-400 min-w-0">
            <Code2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="font-mono font-medium text-zinc-300 uppercase tracking-wide whitespace-nowrap">
              {normalizedLang}
            </span>
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono tabular-nums text-zinc-500 whitespace-nowrap">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isPreviewable && (
              <button
                type="button"
                onClick={() => setShowPreview((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showPreview
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700'
                }`}
              >
                {showPreview ? (
                  <>
                    <Square className="w-3 h-3" />
                    <span>Close Preview</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>Live Preview</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Download file"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Copy code"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto p-3.5 text-[13px] leading-relaxed font-mono">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className="hover:bg-zinc-800/30">
                  <td className="select-none pr-4 text-right text-zinc-600 tabular-nums w-8 align-top">
                    {idx + 1}
                  </td>
                  <td className="whitespace-pre text-zinc-200">
                    {line.length === 0 ? (
                      '\u00A0'
                    ) : (
                      tokenizeLine(line).map((tok, tIdx) => (
                        <span key={tIdx} className={tok.cls}>
                          {tok.text}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showPreview && (
          <div
            className={
              isExpanded
                ? 'fixed inset-0 z-50 bg-[#09090b] flex flex-col'
                : 'border-t border-zinc-800 bg-zinc-950'
            }
          >
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-zinc-800 bg-zinc-900/80">
              <span className="text-xs font-medium text-zinc-300">
                Interactive Live Preview Sandbox
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isExpanded ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span>Exit Fullscreen</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Expand</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <iframe
              title="Live App Sandbox"
              srcDoc={sandboxHtml}
              sandbox="allow-scripts allow-modals"
              className={`w-full bg-white ${
                isExpanded ? 'flex-1 h-full' : 'h-[420px]'
              }`}
            />
          </div>
        )}
      </div>
    );
  }
);
