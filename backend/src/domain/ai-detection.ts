/**
 * Heuristic-based AI text detection for Artizans Collective.
 *
 * No external API required — uses pattern matching and statistical checks
 * to flag content that is likely AI-generated for admin review.
 * Does NOT block submissions; reports are created for human review.
 */

export type AiDetectionResult = {
  flagged: boolean;
  confidence: number; // 0–1
  reasons: string[];
};

/**
 * Detect whether the provided text is likely AI-generated.
 * Returns a result with a confidence score and human-readable reasons.
 */
export function detectAiText(text: string): AiDetectionResult {
  const reasons: string[] = [];
  let score = 0;

  if (!text || text.length < 50) return { flagged: false, confidence: 0, reasons: [] };

  // ─── Common AI-generated phrases ──────────────────────────────────────────
  const aiPhrases = [
    "as an ai",
    "i'm an ai",
    "language model",
    "i cannot",
    "i can't provide",
    "delve into",
    "it's important to note",
    "in conclusion",
    "landscape of",
    "tapestry of",
    "multifaceted",
    "ever-evolving",
    "in today's digital age",
    "in the realm of",
    "harness the power",
    "game-changer",
    "leverage",
    "synergy",
    "paradigm shift",
    "holistic approach",
    "cutting-edge",
    "revolutionary",
    "unleash",
    "unlock the potential",
    "dive deep",
    "it is worth noting",
    "it should be noted",
  ];

  const lower = text.toLowerCase();
  const matched = aiPhrases.filter((p) => lower.includes(p));
  if (matched.length >= 2) {
    score += 0.4;
    reasons.push(
      `Contains ${matched.length} AI-typical phrases: ${matched.slice(0, 3).join(", ")}`,
    );
  } else if (matched.length === 1) {
    score += 0.15;
    reasons.push(`Contains AI-typical phrase: "${matched[0]}"`);
  }

  // ─── Unnaturally uniform sentence structure ────────────────────────────────
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length >= 4) {
    const allPerfect = sentences.every((s) => /^\s*[A-Z]/.test(s));
    if (allPerfect) {
      score += 0.1;
      reasons.push("Unnaturally uniform sentence structure");
    }
  }

  // ─── Excessive hedging / formal transition words ──────────────────────────
  const hedges = [
    "however",
    "furthermore",
    "moreover",
    "additionally",
    "consequently",
    "nevertheless",
  ];
  const hedgeCount = hedges.filter((h) => lower.includes(h)).length;
  if (hedgeCount >= 3) {
    score += 0.2;
    reasons.push(`High use of formal transition words (${hedgeCount} found)`);
  }

  // ─── Very uniform sentence lengths ────────────────────────────────────────
  // AI models tend to produce sentences of strikingly similar word counts.
  if (sentences.length >= 5) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance =
      lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
    if (variance < 4 && avg > 10) {
      score += 0.15;
      reasons.push("Very uniform sentence lengths (typical of AI output)");
    }
  }

  return {
    flagged: score >= 0.3,
    confidence: Math.min(score, 1),
    reasons,
  };
}
