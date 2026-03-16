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

/** Hard-block terms (slurs, hate speech, and all profanity). Matched on word boundaries. */
const BLOCK_WORDS: string[] = [
  "nigger", "nigga", "faggot", "fag", "retard", "kike", "spic",
  "wetback", "chink", "gook", "tranny", "coon", "darkie",
  "beaner", "towelhead", "raghead",
  "fuck", "fucking", "fucker", "motherfucker",
  "shit", "shitty", "bullshit",
  "asshole",
  "bitch", "dick", "cock", "pussy",
  "piss",
  "bastard", "whore", "slut",
];

/** Soft-flag terms (mild language). Allowed through but flagged for review. */
const FLAG_WORDS: string[] = [
  "ass", "damn", "crap", "hell",
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
const REPEATED_WORDS = /\b(\w{2,})\b(?:\s+\1\b){3,}/i;
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// IPv4 address (e.g. 192.168.1.1)
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/;
// IPv6 address (abbreviated, e.g. 2001:0db8::1)
const IPV6_PATTERN = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/;

// Keyboard mash / gibberish sequences
const KEYBOARD_ROWS = [
  "qwertyuiop", "asdfghjkl", "zxcvbnm",
  "qwerty", "asdfgh", "zxcvbn",
];

function isGibberish(text: string): boolean {
  const lower = text.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.length < 6) return false;

  // Check for keyboard row sequences (5+ consecutive chars from one row)
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i <= lower.length - 5; i++) {
      const chunk = lower.slice(i, i + 5);
      if (row.includes(chunk)) return true;
    }
  }

  // High consonant density (e.g. "bdfghjklmnp") — real words have vowels
  // Require 10+ chars to avoid false positives on short names like "Krysztof"
  const consonants = lower.replace(/[aeiouy]/g, "").length;
  if (lower.length >= 10 && consonants / lower.length > 0.8) return true;

  return false;
}

function checkSpamPatterns(text: string, field: string): ModerationReason[] {
  const reasons: ModerationReason[] = [];

  // Excessive URLs (>2 = block, any URL in bio/name = flag)
  const urls = text.match(URL_PATTERN);
  if (urls && urls.length > 2) {
    reasons.push({
      rule: "spam_urls",
      severity: "block",
      field,
      detail: `${urls.length} URLs detected in ${field}.`,
    });
  } else if (urls && urls.length > 0 && (field === "name" || field === "bio")) {
    reasons.push({
      rule: "spam_urls",
      severity: "flag",
      field,
      detail: `URL detected in ${field}.`,
    });
  }

  // Repeated characters (block — clear spam/junk)
  if (REPEATED_CHARS.test(text)) {
    reasons.push({
      rule: "spam_repeated_chars",
      severity: "block",
      field,
      detail: `Excessive repeated characters in ${field}.`,
    });
  }

  // Repeated words (e.g. "lol lol lol lol")
  if (REPEATED_WORDS.test(text)) {
    reasons.push({
      rule: "spam_repeated_words",
      severity: "block",
      field,
      detail: `Repeated word spam in ${field}.`,
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

  // IP address leaking (block)
  if (IPV4_PATTERN.test(text) || IPV6_PATTERN.test(text)) {
    reasons.push({
      rule: "doxxing_ip_address",
      severity: "block",
      field,
      detail: `IP address detected in ${field}.`,
    });
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

  // Gibberish / keyboard mash
  if (isGibberish(text)) {
    reasons.push({
      rule: "gibberish_content",
      severity: "block",
      field,
      detail: `Gibberish or keyboard mash detected in ${field}.`,
    });
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Placeholder / junk detection
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = /^(test|testing|asdf|qwerty|aaa+|xxx+|hello|hi|lol|bruh|yo|idk|na+h*|\.+|\?+|!+|none|n\/a|nothing|blank|null|undefined|no|yes|ok)$/i;

function checkPlaceholder(text: string, field: string): ModerationReason[] {
  const trimmed = text.trim();
  if (trimmed.length > 0 && trimmed.length <= 12 && PLACEHOLDER_PATTERNS.test(trimmed)) {
    return [{
      rule: "placeholder_content",
      severity: "block",
      field,
      detail: `Placeholder or junk content in ${field}.`,
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
