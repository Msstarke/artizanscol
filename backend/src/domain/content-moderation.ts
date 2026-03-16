/**
 * Synchronous, pure-TypeScript content moderation.
 *
 * Checks user-generated text for profanity, spam patterns, and placeholder
 * content. Returns a verdict that callers use to block or flag submissions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModerationSeverity = "block" | "flag";

export type ModerationReason = {
  rule: string;
  severity: ModerationSeverity;
  field: string;
  detail: string;
};

export type ModerationVerdict = {
  allowed: boolean;
  flagged: boolean;
  reasons: ModerationReason[];
};

export type ModerationField = {
  name: string;
  value: string;
};

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

/** Hard-block terms (slurs, hate speech). Matched on word boundaries. */
const BLOCK_WORDS: string[] = [
  "nigger", "nigga", "faggot", "fag", "retard", "kike", "spic",
  "wetback", "chink", "gook", "tranny", "coon", "darkie",
  "beaner", "towelhead", "raghead",
];

/** Soft-flag terms (general profanity). Allowed through but flagged for review. */
const FLAG_WORDS: string[] = [
  "fuck", "fucking", "fucker", "motherfucker",
  "shit", "shitty", "bullshit",
  "ass", "asshole",
  "bitch", "dick", "cock", "pussy",
  "damn", "crap", "piss",
  "bastard", "whore", "slut",
];

// ---------------------------------------------------------------------------
// Leet-speak normalization
// ---------------------------------------------------------------------------

const LEET_MAP: Record<string, string> = {
  "@": "a",
  "4": "a",
  "0": "o",
  "1": "i",
  "!": "i",
  "3": "e",
  "$": "s",
  "5": "s",
  "7": "t",
  "+": "t",
};

function normalizeLeet(text: string): string {
  let result = "";
  for (const ch of text) {
    result += LEET_MAP[ch] ?? ch;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

function buildWordRegex(word: string): RegExp {
  return new RegExp(`\\b${word}\\b`, "i");
}

function checkWordList(
  text: string,
  normalized: string,
  words: string[],
  severity: ModerationSeverity,
  field: string,
): ModerationReason[] {
  const reasons: ModerationReason[] = [];
  for (const word of words) {
    const re = buildWordRegex(word);
    if (re.test(text) || re.test(normalized)) {
      reasons.push({
        rule: severity === "block" ? "prohibited_language" : "profanity",
        severity,
        field,
        detail: `Matched term in ${field}.`,
      });
      break; // one match per list per field is enough
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Spam / abuse patterns
// ---------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/\S+/gi;
const REPEATED_CHARS = /(.)\1{7,}/;
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function checkSpamPatterns(text: string, field: string): ModerationReason[] {
  const reasons: ModerationReason[] = [];

  // Excessive URLs
  const urls = text.match(URL_PATTERN);
  if (urls && urls.length > 2) {
    reasons.push({
      rule: "spam_urls",
      severity: "flag",
      field,
      detail: `${urls.length} URLs detected in ${field}.`,
    });
  }

  // Repeated characters
  if (REPEATED_CHARS.test(text)) {
    reasons.push({
      rule: "spam_repeated_chars",
      severity: "flag",
      field,
      detail: `Excessive repeated characters in ${field}.`,
    });
  }

  // ALL CAPS (only for text longer than 20 chars)
  if (text.length > 20) {
    const letters = text.replace(/[^a-zA-Z]/g, "");
    const upper = letters.replace(/[^A-Z]/g, "");
    if (letters.length > 10 && upper.length / letters.length > 0.7) {
      reasons.push({
        rule: "spam_all_caps",
        severity: "flag",
        field,
        detail: `Excessive uppercase in ${field}.`,
      });
    }
  }

  // Contact info harvesting (phone/email in non-email fields)
  if (field !== "email") {
    if (PHONE_PATTERN.test(text)) {
      reasons.push({
        rule: "contact_info_phone",
        severity: "flag",
        field,
        detail: `Phone number detected in ${field}.`,
      });
    }
    if (EMAIL_PATTERN.test(text)) {
      reasons.push({
        rule: "contact_info_email",
        severity: "flag",
        field,
        detail: `Email address detected in ${field}.`,
      });
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Placeholder detection (flag only)
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = /^(test|testing|asdf|qwerty|aaa+|xxx+|hello|hi|\.+|\?+|!+)$/i;

function checkPlaceholder(text: string, field: string): ModerationReason[] {
  if (text.length > 0 && text.length <= 8 && PLACEHOLDER_PATTERNS.test(text.trim())) {
    return [{
      rule: "placeholder_content",
      severity: "flag",
      field,
      detail: `Placeholder-looking content in ${field}.`,
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function moderateText(fields: ModerationField[]): ModerationVerdict {
  const reasons: ModerationReason[] = [];

  for (const { name, value } of fields) {
    if (!value || typeof value !== "string") continue;

    const text = value.trim();
    if (!text) continue;

    const normalized = normalizeLeet(text.toLowerCase());

    reasons.push(...checkWordList(text, normalized, BLOCK_WORDS, "block", name));
    reasons.push(...checkWordList(text, normalized, FLAG_WORDS, "flag", name));
    reasons.push(...checkSpamPatterns(text, name));
    reasons.push(...checkPlaceholder(text, name));
  }

  const hasBlock = reasons.some((r) => r.severity === "block");
  const hasFlag = reasons.some((r) => r.severity === "flag");

  return {
    allowed: !hasBlock,
    flagged: hasBlock || hasFlag,
    reasons,
  };
}
