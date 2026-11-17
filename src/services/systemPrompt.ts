import type { LiveSource, ModelModeId, PersonaRule } from '../types';

export function buildSystemPrompt(options: {
  modelMode: ModelModeId;
  personaRules: PersonaRule[];
  liveSources?: LiveSource[];
  groundedSummary?: string;
  hasImages?: boolean;
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

  const visionSection = options.hasImages
    ? `\n\n======================================================================\nVISION & IMAGE-TO-APP BUILDER INSTRUCTIONS\n======================================================================
- The user attached image(s) (screenshot, UI mockup, sketch, design reference, or photo of their current work).
- Carefully inspect layout structure, color palette, typography, components, and text shown in the image(s).
- If the user asks to build, clone, recreate, or improve what is shown in the image, output a complete, self-contained runnable \`\`\`html code block (with Tailwind CSS CDN or inline CSS + interactive JS) ready for the Live Preview Sandbox.
- If the user asks to REMOVE, hide, replace, or change specific parts visible in the image, omit or modify ONLY those requested parts while faithfully recreating/improving the rest in runnable code.
- If the user simply asks what is in the image or for feedback, answer clearly and accurately based directly on visual observation.`
    : '';

  const modeHint =
    options.modelMode === 'deepseek-r1'
      ? 'Active Tier: AI Craft Max (Flagship Reasoning & Deep Architecture). Conduct thorough step-by-step analysis inside <think>, verify edge cases, security, accessibility, and responsive behavior, and produce comprehensive, production-grade architectures and solutions with maximum depth.'
      : options.modelMode === 'coder-pro'
        ? 'Active Tier: AI Craft Pro (Advanced Coding & Full-Stack App Builder). Engineer complete, modular, production-ready applications and multi-feature UIs with clean state management, thorough error handling, and zero placeholders inside runnable single-file code ready for Live Preview.'
        : options.modelMode === 'auto'
          ? 'Active Tier: AI Craft Studio (Balanced Creative Design & Smart Routing). Blend polished visual design, clean UX, crisp explanations, and adaptive code generation tailored to the user intent.'
          : options.modelMode === 'searchgpt'
            ? 'Active Tier: AI Craft Plus (Live Web Research & Real-Time Synthesis). Cross-reference retrieved live DuckDuckGo and Wikipedia sources right now, highlight dates/facts accurately, and cite clickable [Source Title](url) Markdown links throughout your answer.'
            : options.modelMode === 'keyless-unlimited'
              ? 'Active Tier: AI Craft Flash (Ultra-Fast Low-Latency). Respond swiftly with concise, crisp, direct answers and clean runnable snippets optimized for minimal latency.'
              : 'Active Tier: AI Craft Mini (On-Device Local Engine). Keep reasoning focused and tight inside <think>, and output clean, compact, complete responses suited for instant on-device execution.';

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
   - [MODE: APP_BUILDER] — build a new UI, feature, tool, website, game, or application.
2. Briefly note the user's goal & key edge cases (plus architecture plan for APP_BUILDER/CODE_DEBUG).

ADAPTIVE RESPONSE RULES:
- CASUAL_CHAT: Reply warmly and concisely; never dump unnecessary code blocks.
- REALTIME_SEARCH: Give clear bulleted facts with clickable [Title](url) links.
- APP_BUILDER / CODE_DEBUG: Dynamically build complete, clean, runnable production code tailored strictly to the user's request—never use "// TODO" stubs or canned placeholder templates. Whenever the user asks to build an app, website, calculator, game, dashboard, or interactive tool, output a complete self-contained document (\`<!doctype html>\` with Tailwind CSS CDN or inline CSS + interactive JS, or a complete \`App\` component) inside a single \`\`\`html (or \`\`\`jsx) code block so it renders automatically in the Live Preview Sandbox.${visionSection}${customTrainerSection}${liveSearchSection}`;
}
