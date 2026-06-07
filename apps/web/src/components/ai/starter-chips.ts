/**
 * Page-aware starter chips for the AI chat drawer.
 *
 * When a fresh chat is opened (no session context, empty thread), we show a few
 * starter prompts relevant to the page the user opened the drawer from, so the
 * first question is one tap away. These are plain prompts (no session context);
 * the AI answers them with its read-only tools.
 */
export type StarterChips = { heading: string; prompts: string[] };

const GENERAL: StarterChips = {
  heading: "Ask about your training",
  prompts: [
    "How's my training going?",
    "Any signs I'm overreaching?",
    "What should I focus on next?",
  ],
};

/**
 * Map a pathname to its starter chips. Order matters — more specific prefixes
 * are checked first. Unknown pages fall back to the general set.
 */
export function starterChipsForPath(pathname: string | null): StarterChips {
  const p = pathname ?? "";
  if (p.startsWith("/app/stats")) {
    return {
      heading: "Ask about your stats",
      prompts: [
        "How has my squat trended lately?",
        "Am I recovering well?",
        "How's my training volume?",
      ],
    };
  }
  if (p.startsWith("/app/plan")) {
    return {
      heading: "Ask about your plan",
      prompts: [
        "What's coming up this week?",
        "Why is next week lighter?",
        "How's my adherence?",
      ],
    };
  }
  if (p.startsWith("/app/sessions")) {
    return {
      heading: "Ask about this session",
      prompts: [
        "Why is this workout programmed this way?",
        "Why these accessories?",
        "Why this order?",
      ],
    };
  }
  if (p.startsWith("/app/training-maxes") || p.startsWith("/app/maxes")) {
    return {
      heading: "Ask about your maxes",
      prompts: [
        "How are my training maxes set?",
        "Which lifts are progressing fastest?",
        "Am I ready to test a max?",
      ],
    };
  }
  // Today / dashboard / everything else.
  if (p === "/app" || p.startsWith("/app/today") || p === "/app/") {
    return {
      heading: "Ask about today",
      prompts: [
        "What should I focus on today?",
        "How's my readiness?",
        "Why is today's workout like this?",
      ],
    };
  }
  return GENERAL;
}
