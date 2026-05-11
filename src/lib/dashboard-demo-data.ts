export const TOKEN_USAGE_SERIES = [
  { label: "Mon", input: 4200, output: 1800 },
  { label: "Tue", input: 5100, output: 2100 },
  { label: "Wed", input: 3800, output: 1600 },
  { label: "Thu", input: 6200, output: 2400 },
  { label: "Fri", input: 5500, output: 2200 },
  { label: "Sat", input: 2100, output: 900 },
  { label: "Sun", input: 1900, output: 800 },
];

export const COST_SERIES = [
  { name: "gpt-4o", spend: 124.5 },
  { name: "gpt-4o-mini", spend: 32.1 },
  { name: "claude-3-5", spend: 58.9 },
  { name: "gemini-1.5", spend: 12.4 },
];

export const HISTORY_ROWS = [
  {
    id: "ph_8k2m",
    title: "Customer support triage",
    model: "gpt-4o",
    tokensIn: 842,
    tokensOut: 312,
    savedPct: 28,
    createdAt: "2026-05-10T14:22:00Z",
    status: "success" as const,
  },
  {
    id: "ph_9p1q",
    title: "RAG summarization prompt",
    model: "claude-3-5-sonnet-20241022",
    tokensIn: 2104,
    tokensOut: 488,
    savedPct: 35,
    createdAt: "2026-05-10T11:05:00Z",
    status: "success" as const,
  },
  {
    id: "ph_7aac",
    title: "SQL copilot — brittle",
    model: "gpt-4o-mini",
    tokensIn: 1201,
    tokensOut: 0,
    savedPct: 0,
    createdAt: "2026-05-09T18:40:00Z",
    status: "error" as const,
  },
  {
    id: "ph_3zz1",
    title: "Marketing email variants",
    model: "gpt-4o",
    tokensIn: 650,
    tokensOut: 890,
    savedPct: 19,
    createdAt: "2026-05-09T09:12:00Z",
    status: "success" as const,
  },
];

export const SAMPLE_PROMPT_BEFORE = `You are a helpful assistant. I need you to help me write a very long and detailed response about how to optimize prompts for LLMs. Please include many examples and explain everything step by step in great detail with redundancy because I want to make sure the model really understands.`;

export const SAMPLE_PROMPT_AFTER = `You are an expert prompt engineer. Produce a concise checklist (max 8 bullets) for optimizing LLM prompts, with one example per bullet. Target audience: senior engineers.`;

export const SAMPLE_STREAM_COMPLETION =
  "Optimized prompt reduces token load by ~34% while preserving intent. Key moves: remove redundancy, assign role and output shape, add constraints (length, audience), and request structured output.";
