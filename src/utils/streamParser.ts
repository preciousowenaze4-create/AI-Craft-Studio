import type { IntentMode } from '../types';

export interface ParsedThinkResult {
  thinkContent: string;
  answerContent: string;
  isThinking: boolean;
  detectedIntent: IntentMode | null;
}

export function parseThinkingContent(raw: string): ParsedThinkResult {
  const openTag = '<think>';
  const closeTag = '</think>';
  const openIdx = raw.indexOf(openTag);

  if (openIdx === -1) {
    // Handle case where model starts emitting partial "<th..." at very start
    const trimmedStart = raw.trimStart();
    if (trimmedStart.startsWith('<') && '<think>'.startsWith(trimmedStart)) {
      return {
        thinkContent: '',
        answerContent: '',
        isThinking: true,
        detectedIntent: null,
      };
    }
    return {
      thinkContent: '',
      answerContent: raw,
      isThinking: false,
      detectedIntent: extractIntent(raw),
    };
  }

  const afterOpen = raw.slice(openIdx + openTag.length);
  const closeIdx = afterOpen.indexOf(closeTag);

  if (closeIdx === -1) {
    // Still actively streaming inside <think>
    // Strip trailing partial "</think>" prefix if present
    let cleanThink = afterOpen;
    for (let i = closeTag.length - 1; i >= 1; i--) {
      if (cleanThink.endsWith(closeTag.slice(0, i))) {
        cleanThink = cleanThink.slice(0, -i);
        break;
      }
    }
    return {
      thinkContent: cleanThink.trimStart(),
      answerContent: '',
      isThinking: true,
      detectedIntent: extractIntent(cleanThink),
    };
  }

  const thinkContent = afterOpen.slice(0, closeIdx).trim();
  const answerContent = afterOpen.slice(closeIdx + closeTag.length).trimStart();
  return {
    thinkContent,
    answerContent,
    isThinking: false,
    detectedIntent: extractIntent(thinkContent),
  };
}

function extractIntent(text: string): IntentMode | null {
  const match = text.match(/\[MODE:\s*(CASUAL_CHAT|REALTIME_SEARCH|CODE_DEBUG|APP_BUILDER)\]/i);
  if (!match) return null;
  return match[1].toUpperCase() as IntentMode;
}

export interface MarkdownSegment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

export function splitMarkdownSegments(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const lines = markdown.split('\n');
  let inCode = false;
  let currentLang = '';
  let buffer: string[] = [];

  for (const line of lines) {
    const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
    if (!inCode && fenceMatch) {
      if (buffer.length > 0) {
        segments.push({ type: 'text', content: buffer.join('\n') });
        buffer = [];
      }
      inCode = true;
      currentLang = fenceMatch[1] || 'text';
    } else if (inCode && line.trim() === '```') {
      segments.push({
        type: 'code',
        language: currentLang,
        content: buffer.join('\n'),
      });
      buffer = [];
      inCode = false;
      currentLang = '';
    } else {
      buffer.push(line);
    }
  }

  if (buffer.length > 0) {
    if (inCode) {
      // Unclosed streaming code fence
      segments.push({
        type: 'code',
        language: currentLang,
        content: buffer.join('\n'),
      });
    } else {
      segments.push({ type: 'text', content: buffer.join('\n') });
    }
  }

  return segments;
}

export function extractMarkdownTables(markdown: string): string[][][] {
  const tables: string[][][] = [];
  const lines = markdown.split('\n');
  let currentTable: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      // Skip markdown separator rows like |---|---|
      const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c));
      if (!isSeparator) {
        currentTable.push(cells);
      }
    } else if (currentTable.length >= 2) {
      tables.push(currentTable);
      currentTable = [];
    } else {
      currentTable = [];
    }
  }

  if (currentTable.length >= 2) {
    tables.push(currentTable);
  }

  return tables;
}
