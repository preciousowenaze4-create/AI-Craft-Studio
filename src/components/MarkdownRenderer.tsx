import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { splitMarkdownSegments } from '../utils/streamParser';
import { CodeBlock } from './CodeBlock';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onExportTableToSheets?: (rows: string[][]) => void;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }

    if (match[2] && match[3]) {
      parts.push(
        <a
          key={keyCounter++}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      parts.push(
        <code
          key={keyCounter++}
          className="px-1.5 py-0.5 rounded bg-zinc-800/90 text-indigo-200 font-mono text-[13px] border border-zinc-700/60"
        >
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      parts.push(
        <strong key={keyCounter++} className="font-semibold text-zinc-100">
          {match[5]}
        </strong>
      );
    } else if (match[6]) {
      parts.push(
        <em key={keyCounter++} className="italic text-zinc-200">
          {match[6]}
        </em>
      );
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

function renderTextBlock(
  text: string,
  onExportTableToSheets?: (rows: string[][]) => void
): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Markdown table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableRows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!(rowLine.startsWith('|') && rowLine.endsWith('|'))) break;
        const cells = rowLine
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c));
        if (!isSep) {
          tableRows.push(cells);
        }
        i++;
      }

      if (tableRows.length > 0) {
        const [header, ...body] = tableRows;
        nodes.push(
          <div
            key={key++}
            className="my-3 rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/40"
          >
            {onExportTableToSheets && (
              <div className="flex items-center justify-end px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/70">
                <button
                  type="button"
                  onClick={() => onExportTableToSheets(tableRows)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 hover:text-emerald-200 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Table to Google Sheets</span>
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    {header.map((cell, cIdx) => (
                      <th
                        key={cIdx}
                        className="px-3.5 py-2.5 text-xs font-semibold text-zinc-300 whitespace-nowrap"
                      >
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {body.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-zinc-800/30">
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className="px-3.5 py-2 text-zinc-300 text-[13px] tabular-nums"
                        >
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls =
        level === 1
          ? 'text-xl font-bold text-zinc-100 mt-4 mb-2'
          : level === 2
            ? 'text-lg font-semibold text-zinc-100 mt-3.5 mb-1.5'
            : 'text-base font-semibold text-zinc-200 mt-3 mb-1';
      nodes.push(
        <div key={key++} className={cls}>
          {renderInline(content)}
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      nodes.push(<hr key={key++} className="my-4 border-zinc-800" />);
      i++;
      continue;
    }

    // Blockquote (subtle all-around border, no thick left accent border)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      nodes.push(
        <blockquote
          key={key++}
          className="my-2.5 px-3.5 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-300"
        >
          {renderInline(quoteLines.join(' '))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      nodes.push(
        <ul key={key++} className="my-2 space-y-1.5 pl-5 list-disc text-zinc-200">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed text-[15px]">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      nodes.push(
        <ol key={key++} className="my-2 space-y-1.5 pl-5 list-decimal text-zinc-200">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed text-[15px]">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s+|[-*+]\s+|\d+\.\s+|>\s?|[-*_]{3,}$|\|)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={key++} className="my-2 text-[15px] leading-[1.65] text-zinc-200 whitespace-pre-wrap">
        {renderInline(paraLines.join('\n'))}
      </p>
    );
  }

  return nodes;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(
  ({ content, isStreaming = false, onExportTableToSheets }) => {
    const segments = splitMarkdownSegments(content);

    return (
      <div className="space-y-1">
        {segments.map((seg, idx) =>
          seg.type === 'code' ? (
            <CodeBlock
              key={idx}
              code={seg.content}
              language={seg.language}
              isClosed={seg.isClosed}
              isStreaming={isStreaming}
            />
          ) : (
            <React.Fragment key={idx}>
              {renderTextBlock(seg.content, onExportTableToSheets)}
            </React.Fragment>
          )
        )}
      </div>
    );
  }
);
