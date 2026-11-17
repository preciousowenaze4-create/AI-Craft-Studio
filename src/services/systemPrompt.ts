import type { LiveSource, ModelModeId, PersonaRule } from '../types';

export function buildSystemPrompt(options: {
  modelMode: ModelModeId;
  personaRules: PersonaRule[];
  liveSources?: LiveSource[];
  groundedSummary?: string;
}): string {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(now);

  const activeRules = options.personaRules.filter((r) => r.enabled);
  let customTrainerSection = '';
  if (activeRules.length > 0) {
    const formattedRules = activeRules
      .map((r) => {
        if (r.type === 'qa' && r.answer) {
          return `- [Q&A Example] Q: ${r.content}\n  A: ${r.answer}`;
        }
        return `- [${r.type.toUpperCase()}: ${r.label}] ${r.content}`;
      })
      .join('\n');
    customTrainerSection = `\n\n======================================================================\nUSER-TRAINED CUSTOM PERSONA, RULES & DOMAIN FACTS\n======================================================================\nFollow these owner-defined rules and facts as high-priority instructions:\n${formattedRules}`;
  }

  let liveSearchSection = '';
  if (
    (options.liveSources && options.liveSources.length > 0) ||
    options.groundedSummary
  ) {
    const sourcesList = (options.liveSources || [])
      .map(
        (s, idx) =>
          `[${idx + 1}] (${s.provider}) ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`
      )
      .join('\n\n');

    liveSearchSection = `\n\n======================================================================\nLIVE INTERNET DATA & REAL-TIME CITATIONS (FETCHED RIGHT NOW)\n======================================================================\n${
      options.groundedSummary
        ? `Synthesized Grounding Context:\n${options.groundedSummary}\n\n`
        : ''
    }Live Sources:\n${sourcesList}\n\nCite relevant facts accurately and include clickable Markdown links [Source Title](url) in your response.`;
  }

  const modeHint =
    options.modelMode === 'coder-pro'
      ? 'Active Mode: Coder Pro (Full-Stack App Builder). Prioritize complete, runnable, single-file or modular production code with zero placeholders.'
      : options.modelMode === 'searchgpt'
        ? 'Active Mode: SearchGPT (Live Real-Time Web Search). Prioritize up-to-date facts, dates, and source citations.'
        : options.modelMode === 'deepseek-r1'
          ? 'Active Mode: DeepSeek-R1 (Deep Step-by-Step Reasoning). Perform thorough analytical verification inside <think>.'
          : options.modelMode === 'local-webgpu'
            ? 'Active Mode: Local Browser AI. Keep reasoning crisp and output clean, well-structured responses.'
            : 'Active Mode: Auto-Router (Fast + Unlimited). Adapt seamlessly to user intent.';

  return `You are AI Craft Studio, a fast, helpful AI collaborator, real-time researcher, and senior full-stack software architect.

CURRENT LIVE SYSTEM CLOCK:
- Local Date & Time: ${formattedDate} (${timeZone})
- ISO Timestamp: ${now.toISOString()}
Always rely on this clock for today's date, day, year, and recent events.

${modeHint}

MANDATORY THINKING & INTENT CLASSIFICATION:
Start every response with <think>...</think> before your final answer. Inside <think>:
1. Classify intent with EXACTLY ONE tag:
   - [MODE: CASUAL_CHAT] — conversation, greetings, brainstorming, advice.
   - [MODE: REALTIME_SEARCH] — live facts, news, prices, weather, places, web lookups.
   - [MODE: CODE_DEBUG] — explain, fix, or optimize existing code.
   - [MODE: APP_BUILDER] — build a new UI, feature, tool, game, or application.
2. Briefly note the user's goal & key edge cases (plus architecture plan for APP_BUILDER/CODE_DEBUG).

ADAPTIVE RESPONSE RULES:
- CASUAL_CHAT: Reply warmly and concisely; never dump unnecessary code blocks.
- REALTIME_SEARCH: Give clear bulleted facts with clickable [Title](url) links.
- APP_BUILDER / CODE_DEBUG: Provide complete, runnable production code with zero "// TODO" placeholders. For web apps, prefer a single self-contained HTML file (Tailwind CDN or clean CSS + JS) inside a \`\`\`html code block so it runs in the Live Preview Sandbox.${customTrainerSection}${liveSearchSection}`;
}
