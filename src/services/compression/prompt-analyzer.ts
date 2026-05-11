/**
 * Prompt Analyzer
 *
 * Detects prompt type and characteristics before compression.
 * This drives strategy selection — a coding prompt needs different
 * treatment than a conversational one.
 *
 * Why analyze first:
 * - Prevents code blocks from being "compressed" (breaks syntax)
 * - Identifies agent prompts that have strict instruction formats
 * - Detects technical content that must be preserved verbatim
 */

import "server-only";

import { PromptType } from "@/types/compression";

// ─── Analysis Result ──────────────────────────────────────────────────────────

export interface PromptAnalysis {
  type: PromptType;
  /** Detected characteristics */
  characteristics: PromptCharacteristics;
  /** Regions that must be protected from modification */
  protectedPatterns: RegExp[];
}

export interface PromptCharacteristics {
  hasCodeBlocks: boolean;
  hasUrls: boolean;
  hasVariables: boolean;        // {{variable}} or {variable} patterns
  hasNumberedLists: boolean;
  hasBulletLists: boolean;
  hasJsonOrXml: boolean;
  hasMarkdown: boolean;
  hasAgentInstructions: boolean; // "You are...", "Your task is..."
  hasConstraints: boolean;       // "Do not...", "Never...", "Always..."
  estimatedComplexity: "low" | "medium" | "high";
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
}

// ─── Detection Patterns ───────────────────────────────────────────────────────

const PATTERNS = {
  codeBlock: /```[\s\S]*?```|`[^`]+`/g,
  inlineCode: /`[^`\n]+`/g,
  url: /https?:\/\/[^\s)>\]"]+/g,
  variable: /\{\{?\s*\w+\s*\}?\}|\$\{[^}]+\}|\$\w+/g,
  numberedList: /^\s*\d+[.)]\s+/m,
  bulletList: /^\s*[-*•]\s+/m,
  json: /\{[\s\S]*"[\w]+"\s*:/,
  xml: /<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z]+>/,
  agentInstruction: /\b(you are|your (role|task|job|goal|purpose) is|act as|behave as|you must|you should)\b/i,
  constraint: /\b(do not|don't|never|always|must not|cannot|avoid|prohibited|forbidden)\b/i,
  markdown: /#{1,6}\s+\w|^\*\*[^*]+\*\*|__[^_]+__/m,
} as const;

// ─── Analyzer ────────────────────────────────────────────────────────────────

export class PromptAnalyzer {
  /**
   * Analyze a prompt and return its type + characteristics.
   */
  analyze(text: string): PromptAnalysis {
    const characteristics = this.extractCharacteristics(text);
    const type = this.detectType(text, characteristics);
    const protectedPatterns = this.buildProtectedPatterns(characteristics);

    return { type, characteristics, protectedPatterns };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private extractCharacteristics(text: string): PromptCharacteristics {
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    return {
      hasCodeBlocks: PATTERNS.codeBlock.test(text),
      hasUrls: PATTERNS.url.test(text),
      hasVariables: PATTERNS.variable.test(text),
      hasNumberedLists: PATTERNS.numberedList.test(text),
      hasBulletLists: PATTERNS.bulletList.test(text),
      hasJsonOrXml: PATTERNS.json.test(text) || PATTERNS.xml.test(text),
      hasMarkdown: PATTERNS.markdown.test(text),
      hasAgentInstructions: PATTERNS.agentInstruction.test(text),
      hasConstraints: PATTERNS.constraint.test(text),
      estimatedComplexity: this.estimateComplexity(text, words.length),
      wordCount: words.length,
      sentenceCount: sentences.length,
      avgWordsPerSentence:
        sentences.length > 0 ? Math.round(words.length / sentences.length) : 0,
    };
  }

  private detectType(text: string, chars: PromptCharacteristics): PromptType {
    const lower = text.toLowerCase();

    // Agent prompts: explicit role assignment + constraints
    if (chars.hasAgentInstructions && chars.hasConstraints) {
      return PromptType.AGENT;
    }

    // System prompts: starts with role definition, no user question
    if (
      chars.hasAgentInstructions &&
      (lower.startsWith("you are") || lower.startsWith("you're"))
    ) {
      return PromptType.SYSTEM;
    }

    // Coding prompts: code blocks or programming keywords
    if (
      chars.hasCodeBlocks ||
      chars.hasJsonOrXml ||
      /\b(function|class|const|let|var|def|import|export|return|async|await|interface|type)\b/.test(text)
    ) {
      return PromptType.CODING;
    }

    // Technical prompts: technical terminology without code
    if (
      /\b(api|endpoint|database|schema|query|algorithm|architecture|infrastructure|deployment|configuration)\b/i.test(text)
    ) {
      return PromptType.TECHNICAL;
    }

    // Instruction prompts: imperative, numbered steps
    if (
      chars.hasNumberedLists ||
      (chars.hasConstraints && chars.estimatedComplexity !== "low")
    ) {
      return PromptType.INSTRUCTION;
    }

    // Conversational: short, informal
    if (chars.wordCount < 50 && chars.avgWordsPerSentence < 15) {
      return PromptType.CONVERSATIONAL;
    }

    return PromptType.GENERAL;
  }

  private estimateComplexity(
    text: string,
    wordCount: number,
  ): "low" | "medium" | "high" {
    if (wordCount < 50) return "low";
    if (wordCount < 200) return "medium";
    return "high";
  }

  private buildProtectedPatterns(chars: PromptCharacteristics): RegExp[] {
    const patterns: RegExp[] = [];

    if (chars.hasCodeBlocks) {
      patterns.push(/```[\s\S]*?```/g);
      patterns.push(/`[^`\n]+`/g);
    }
    if (chars.hasUrls) {
      patterns.push(/https?:\/\/[^\s)>\]"]+/g);
    }
    if (chars.hasVariables) {
      patterns.push(/\{\{?\s*\w+\s*\}?\}/g);
      patterns.push(/\$\{[^}]+\}/g);
    }
    if (chars.hasJsonOrXml) {
      patterns.push(/\{[\s\S]*?\}/g);
      patterns.push(/<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z]+>/g);
    }

    return patterns;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: PromptAnalyzer | null = null;
export function getPromptAnalyzer(): PromptAnalyzer {
  instance ??= new PromptAnalyzer();
  return instance;
}
