/**
 * Verbosity Reduction Strategy — BALANCED mode
 *
 * Replaces verbose phrases with concise equivalents.
 * These are deterministic substitutions — no AI needed, no meaning loss.
 *
 * Examples:
 *   "In order to" → "To"
 *   "Please make sure that you" → "Ensure"
 *   "It is important to note that" → "Note:"
 *   "Due to the fact that" → "Because"
 */

import "server-only";

import { OptimizationMode, PromptType } from "@/types/compression";
import type { ICompressionStrategy, StrategyContext, StrategyResult } from "@/types/compression";

// ─── Substitution Tables ──────────────────────────────────────────────────────

interface Substitution {
  pattern: RegExp;
  replacement: string;
  description: string;
}

// General verbosity patterns — safe for all prompt types
const GENERAL_SUBSTITUTIONS: Substitution[] = [
  // Filler phrases
  { pattern: /\bin order to\b/gi, replacement: "to", description: "in-order-to→to" },
  { pattern: /\bdue to the fact that\b/gi, replacement: "because", description: "due-to-fact→because" },
  { pattern: /\bat this point in time\b/gi, replacement: "now", description: "at-this-point→now" },
  { pattern: /\bin the event that\b/gi, replacement: "if", description: "in-event-that→if" },
  { pattern: /\bfor the purpose of\b/gi, replacement: "to", description: "for-purpose-of→to" },
  { pattern: /\bwith regard to\b/gi, replacement: "regarding", description: "with-regard-to→regarding" },
  { pattern: /\bwith respect to\b/gi, replacement: "regarding", description: "with-respect-to→regarding" },
  { pattern: /\bin spite of the fact that\b/gi, replacement: "although", description: "in-spite-of→although" },
  { pattern: /\bprior to\b/gi, replacement: "before", description: "prior-to→before" },
  { pattern: /\bsubsequent to\b/gi, replacement: "after", description: "subsequent-to→after" },
  { pattern: /\bin close proximity to\b/gi, replacement: "near", description: "in-proximity→near" },
  { pattern: /\ba large number of\b/gi, replacement: "many", description: "large-number→many" },
  { pattern: /\ba small number of\b/gi, replacement: "few", description: "small-number→few" },
  { pattern: /\bthe majority of\b/gi, replacement: "most", description: "majority-of→most" },
  { pattern: /\bthe fact that\b/gi, replacement: "that", description: "the-fact-that→that" },

  // Polite but redundant preambles
  { pattern: /\bplease (make sure|ensure) (that )?you\b/gi, replacement: "ensure you", description: "please-make-sure→ensure" },
  { pattern: /\bplease note that\b/gi, replacement: "note:", description: "please-note→note" },
  { pattern: /\bit is important (to note )?that\b/gi, replacement: "importantly,", description: "important-to-note→importantly" },
  { pattern: /\bit should be noted that\b/gi, replacement: "note:", description: "should-be-noted→note" },
  { pattern: /\bkindly\b/gi, replacement: "please", description: "kindly→please" },
  { pattern: /\bI would like you to\b/gi, replacement: "please", description: "i-would-like→please" },
  { pattern: /\bI want you to\b/gi, replacement: "please", description: "i-want-you-to→please" },
  { pattern: /\bCould you please\b/gi, replacement: "please", description: "could-you-please→please" },
  { pattern: /\bWould you (please |kindly )?\b/gi, replacement: "please ", description: "would-you→please" },

  // Redundant qualifiers
  { pattern: /\bvery unique\b/gi, replacement: "unique", description: "very-unique→unique" },
  { pattern: /\bcompletely (unique|different|separate)\b/gi, replacement: "$1", description: "completely-X→X" },
  { pattern: /\babsolutely (necessary|required|essential)\b/gi, replacement: "$1", description: "absolutely-X→X" },
  { pattern: /\bbasically\b/gi, replacement: "", description: "removed-basically" },
  { pattern: /\bessentially\b/gi, replacement: "", description: "removed-essentially" },
  { pattern: /\bactually\b/gi, replacement: "", description: "removed-actually" },
  { pattern: /\bliterally\b/gi, replacement: "", description: "removed-literally" },
  { pattern: /\bjust\b(?! in time| now| yet)/gi, replacement: "", description: "removed-just" },

  // Wordy connectors
  { pattern: /\bin addition to this,?\b/gi, replacement: "also,", description: "in-addition→also" },
  { pattern: /\bfurthermore,?\b/gi, replacement: "also,", description: "furthermore→also" },
  { pattern: /\bmoreover,?\b/gi, replacement: "also,", description: "moreover→also" },
  { pattern: /\bnevertheless,?\b/gi, replacement: "however,", description: "nevertheless→however" },
  { pattern: /\bnotwithstanding,?\b/gi, replacement: "however,", description: "notwithstanding→however" },
];

// Instruction-specific patterns (agent/system prompts)
const INSTRUCTION_SUBSTITUTIONS: Substitution[] = [
  { pattern: /\bYour (primary )?task is to\b/gi, replacement: "Task:", description: "your-task-is→task" },
  { pattern: /\bYour (primary )?goal is to\b/gi, replacement: "Goal:", description: "your-goal-is→goal" },
  { pattern: /\bYour (primary )?role is to\b/gi, replacement: "Role:", description: "your-role-is→role" },
  { pattern: /\bYou are responsible for\b/gi, replacement: "Responsibility:", description: "responsible-for→responsibility" },
  { pattern: /\bWhen (the )?user (asks?|requests?|wants?)\b/gi, replacement: "On user request,", description: "when-user-asks→on-request" },
  { pattern: /\bIf (the )?user (asks?|requests?|wants?)\b/gi, replacement: "If user requests,", description: "if-user-asks→if-requests" },
];

// Natural-language wrappers around coding tasks — prompts often classify as CODING because of the word "function"
const CODING_PROSE_SUBSTITUTIONS: Substitution[] = [
  { pattern: /\bWrite a Python function that\b/gi, replacement: "Python fn:", description: "write-py-fn-colon" },
  { pattern: /\bCreate a Python function that\b/gi, replacement: "Python fn:", description: "create-py-fn-colon" },
  { pattern: /\bWrite a function (in Python )?that\b/gi, replacement: "Fn:", description: "write-fn-colon" },
  { pattern: /\bImplement a (python )?function that\b/gi, replacement: "Implement fn:", description: "implement-fn" },
  { pattern: /\bPlease write\b/gi, replacement: "Write", description: "please-write" },
  { pattern: /\bI would like you to write\b/gi, replacement: "Write", description: "i-would-like-write" },
  { pattern: /\bI need you to write\b/gi, replacement: "Write", description: "i-need-write" },
  { pattern: /\bThe function should\b/gi, replacement: "Should", description: "fn-should" },
  { pattern: /\bThe function must\b/gi, replacement: "Must", description: "fn-must" },
  { pattern: /\bMake sure (to |that you )?/gi, replacement: "Ensure ", description: "make-sure→ensure" },
  { pattern: /\bInclude proper error handling\b/gi, replacement: "Handle errors", description: "proper-err-handling" },
  { pattern: /\bwith error handling\b/gi, replacement: "handle errors", description: "with-error-handling" },
  { pattern: /\bAdd comments (to explain|explaining)?\b/gi, replacement: "Comment", description: "add-comments" },
  { pattern: /\bEdge cases should be handled\b/gi, replacement: "Handle edge cases", description: "edge-cases" },
  { pattern: /\bIt needs to handle\b/gi, replacement: "Handle", description: "it-needs-handle" },
];

export class VerbosityStrategy implements ICompressionStrategy {
  readonly name = "verbosity-reduction";
  readonly description = "Replace verbose phrases with concise equivalents";
  /** SAFE: deterministic phrase shortening only; no LLM. */
  readonly minimumMode = OptimizationMode.SAFE;
  readonly applicableTypes: PromptType[] = []; // All types

  async apply(text: string, context: StrategyContext): Promise<StrategyResult> {
    const transformations: string[] = [];
    let result = text;

    const substitutions = [
      ...GENERAL_SUBSTITUTIONS,
      ...(context.promptType === PromptType.CODING ? CODING_PROSE_SUBSTITUTIONS : []),
      // Add instruction substitutions for agent/system/instruction prompts
      ...(
        [PromptType.AGENT, PromptType.SYSTEM, PromptType.INSTRUCTION].includes(context.promptType)
          ? INSTRUCTION_SUBSTITUTIONS
          : []
      ),
    ];

    for (const sub of substitutions) {
      const before = result;
      result = result.replace(sub.pattern, sub.replacement);
      // Clean up double spaces left by empty replacements
      result = result.replace(/ {2,}/g, " ").replace(/ ,/g, ",");
      if (result !== before) {
        transformations.push(sub.description);
      }
    }

    return {
      text: result.trim(),
      transformationsApplied: transformations,
      tokensRemoved: 0,
    };
  }
}
