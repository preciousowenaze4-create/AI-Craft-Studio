// Cross-browser & iOS Safari resilient Web Speech API TTS manager

type SpeechListener = (activeMessageId: string | null) => void;

let currentMessageId: string | null = null;
let playbackSessionId = 0;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let chunkQueue: string[] = [];
let chunkIndex = 0;
let selectedVoiceCache: SpeechSynthesisVoice | null = null;
const listeners = new Set<SpeechListener>();

const LOW_QUALITY_OR_NOVELTY_VOICES =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eddy|flo|fred|good news|grandma|grandpa|hysterical|jester|junior|kathy|organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox|espeak)\b/i;

const PREFERRED_NATURAL_VOICES = [
  /samantha.*enhanced|ava.*premium|zoe.*premium|allison.*enhanced|susan.*enhanced/i,
  /natural|neural|online \(natural\)|premium|enhanced/i,
  /google us english|google uk english/i,
  /\b(samantha|ava|allison|nicky|aaron|daniel|karen|serena|moira|tessa|alex|siri)\b/i,
];

function notifyListeners() {
  for (const listener of listeners) {
    listener(currentMessageId);
  }
}

export function subscribeSpeechState(listener: SpeechListener): () => void {
  listeners.add(listener);
  listener(currentMessageId);
  return () => {
    listeners.delete(listener);
  };
}

export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

export function pickBestEnglishVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return selectedVoiceCache;

  const englishVoices = voices.filter((v) =>
    v.lang?.toLowerCase().startsWith('en')
  );
  const pool = englishVoices.length > 0 ? englishVoices : voices;

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of pool) {
    let score = 0;
    const name = `${voice.name} ${voice.voiceURI}`;
    const lang = (voice.lang || '').toLowerCase();

    if (LOW_QUALITY_OR_NOVELTY_VOICES.test(name)) {
      score -= 100;
    }

    if (lang === 'en-us') score += 25;
    else if (lang === 'en-gb') score += 20;
    else if (lang.startsWith('en')) score += 12;

    if (voice.localService) score += 8;
    if (voice.default) score += 4;

    PREFERRED_NATURAL_VOICES.forEach((pattern, idx) => {
      if (pattern.test(name)) {
        score += (PREFERRED_NATURAL_VOICES.length - idx) * 20;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  selectedVoiceCache = bestVoice;
  return bestVoice;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    pickBestEnglishVoice();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      selectedVoiceCache = null;
      pickBestEnglishVoice();
    });
  } catch {
    // Ignore environments where event listener is unavailable
  }
}

export function cleanMarkdownForSpeech(rawText: string): string {
  let text = rawText || '';

  // Remove any residual <think>...</think> blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  text = text.replace(/<\/?think>/gi, ' ');

  // Replace fenced code blocks cleanly
  text = text.replace(/```[\s\S]*?```/g, ' Code block omitted. ');

  // Convert Markdown images ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, ' $1 ');

  // Convert Markdown links [label](url) -> label
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Replace bare URLs with a clean spoken reference
  text = text.replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+)\S*/g, '$1');

  // Strip inline code backticks while keeping readable label
  text = text.replace(/`([^`]+)`/g, '$1');

  // Strip Markdown table separator lines (e.g., |---|---|)
  text = text.replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/gm, ' ');

  // Convert table row pipes into natural pauses
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, inner: string) =>
    inner
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
      .join(', ') + '. '
  );

  // Strip Markdown headings (#, ##, ###, etc.)
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');

  // Strip blockquotes
  text = text.replace(/^\s*>\s?/gm, '');

  // Strip horizontal rules
  text = text.replace(/^\s*([-*_])\1{2,}\s*$/gm, ' ');

  // Strip emphasis / bold / strikethrough markers
  text = text.replace(/(\*\*\*|___)(.*?)\1/g, '$2');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  text = text.replace(/[*_`~#]+/g, ' ');

  // Clean bullet & numbered list prefixes
  text = text.replace(/^\s*[-*+•]\s+/gm, '');
  text = text.replace(/^\s*(\d+)[.)]\s+/gm, '$1. ');

  // Strip leftover HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Normalize whitespace & punctuation pauses
  text = text.replace(/\n{2,}/g, '. ');
  text = text.replace(/\n/g, ', ');
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\s+([.,!?;:])/g, '$1');
  text = text.replace(/([.,!?;:])\s*\./g, '$1');

  return text.trim();
}

function splitIntoSpeechChunks(text: string, maxLen = 210): string[] {
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      // Split overly long sentence on commas/spaces so iOS Safari never drops it
      const words = sentence.split(/\s+/);
      let piece = '';
      for (const w of words) {
        const candidate = piece ? `${piece} ${w}` : w;
        if (candidate.length > maxLen && piece) {
          chunks.push(piece);
          piece = w;
        } else {
          piece = candidate;
        }
      }
      if (piece) chunks.push(piece);
    } else {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > maxLen && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function speakNextChunk(sessionId: number) {
  if (sessionId !== playbackSessionId || !isSpeechSupported()) return;

  if (chunkIndex >= chunkQueue.length) {
    currentMessageId = null;
    activeUtterance = null;
    chunkQueue = [];
    notifyListeners();
    return;
  }

  const chunkText = chunkQueue[chunkIndex];
  const utterance = new SpeechSynthesisUtterance(chunkText);
  const voice = pickBestEnglishVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = 'en-US';
  }
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => {
    if (sessionId !== playbackSessionId) return;
    chunkIndex += 1;
    speakNextChunk(sessionId);
  };

  utterance.onerror = () => {
    if (sessionId !== playbackSessionId) return;
    currentMessageId = null;
    activeUtterance = null;
    chunkQueue = [];
    notifyListeners();
  };

  activeUtterance = utterance;

  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    currentMessageId = null;
    activeUtterance = null;
    chunkQueue = [];
    notifyListeners();
  }
}

export function stopSpeech() {
  playbackSessionId += 1;
  chunkQueue = [];
  chunkIndex = 0;
  activeUtterance = null;
  currentMessageId = null;
  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
  notifyListeners();
}

export function toggleMessageSpeech(messageId: string, rawText: string): boolean {
  if (!isSpeechSupported()) return false;

  if (currentMessageId === messageId) {
    stopSpeech();
    return false;
  }

  const cleaned = cleanMarkdownForSpeech(rawText);
  if (!cleaned) {
    stopSpeech();
    return false;
  }

  const synth = window.speechSynthesis;
  const wasActive = synth.speaking || synth.pending;

  playbackSessionId += 1;
  const sessionId = playbackSessionId;
  chunkQueue = splitIntoSpeechChunks(cleaned);
  chunkIndex = 0;
  currentMessageId = messageId;
  notifyListeners();

  if (wasActive) {
    try {
      synth.cancel();
    } catch {
      // ignore
    }
    // Brief delay prevents iOS Safari from cancelling the newly queued utterance
    window.setTimeout(() => {
      speakNextChunk(sessionId);
    }, 60);
  } else {
    // Speak synchronously inside click handler for strict iOS Safari gesture activation
    speakNextChunk(sessionId);
  }

  return true;
}

export function getActiveUtteranceDebug(): SpeechSynthesisUtterance | null {
  return activeUtterance;
}
