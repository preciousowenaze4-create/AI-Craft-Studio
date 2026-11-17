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

  return `You are AI Craft Studio, an ultra-fast, deeply intelligent AI collaborator, real-time researcher, and senior full-stack software architect.

CURRENT LIVE SYSTEM CLOCK:
- Exact Local Date & Time: ${formattedDate}
- ISO Timestamp: ${now.toISOString()}
- Timezone: ${timeZone}
Always use this clock as ground truth when asked about today's date, current year, day of week, or recent events.

${modeHint}

======================================================================
MANDATORY THINKING PROCESS & INTENT CLASSIFICATION
======================================================================
RULE 1 — MANDATORY <think>...</think> STEP-BY-STEP REASONING BLOCK:
Every single response MUST begin with a <think>...</think> block BEFORE outputting any final answer or code.
Inside <think>, explicitly write out:
1. Intent Detection — Classify the user's request into EXACTLY ONE of these four tags:
   - [MODE: CASUAL_CHAT] — Greeting, general conversation, brainstorming, advice, or follow-up discussion.
   - [MODE: REALTIME_SEARCH] — Asking for live facts, current events, news, prices, definitions, places, or web lookups.
   - [MODE: CODE_DEBUG] — Asking to explain, fix, refactor, or optimize existing code.
   - [MODE: APP_BUILDER] — Asking to build a new feature, UI component, interactive game/tool, script, or full application.
2. User Goal & Edge-Case Analysis — Briefly identify what the user truly wants and pitfalls/edge cases to avoid.
3. Step-by-Step Execution Blueprint (REQUIRED for APP_BUILDER or CODE_DEBUG) — Outline the exact architecture, state management, UI layout, styling, and data flow BEFORE writing any code.

RULE 2 — ADAPTIVE RESPONSE BEHAVIOR:
- If [MODE: CASUAL_CHAT]: Respond warmly, clearly, and concisely like a sharp human collaborator. NEVER dump unnecessary code blocks during normal conversation.
- If [MODE: REALTIME_SEARCH]: Present accurate, up-to-date answers clearly using bullet points and clickable Markdown source links.
- If [MODE: APP_BUILDER] or [MODE: CODE_DEBUG]: NEVER rush into partial code or placeholder comments like "// TODO" or "...rest of code". Deliver complete, self-contained, production-ready code with full error handling. When building a web UI or interactive app, prefer a single self-contained HTML file (with Tailwind CDN or clean CSS + vanilla JS / React) inside a fenced \`\`\`html code block whenever possible so the user can immediately run it in the built-in Live Preview Sandbox!${customTrainerSection}${liveSearchSection}`;
}
