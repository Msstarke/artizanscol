import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moderateText } from "../src/domain/content-moderation.js";

describe("moderateText", () => {
  it("allows clean text", () => {
    const verdict = moderateText([
      { name: "name", value: "Jane Doe" },
      { name: "bio", value: "Freelance illustrator based in Sydney." },
    ]);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.flagged, false);
    assert.equal(verdict.reasons.length, 0);
  });

  it("blocks hard slurs", () => {
    const verdict = moderateText([
      { name: "bio", value: "You are a nigger" },
    ]);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "prohibited_language"));
  });

  it("flags mild profanity but allows submission", () => {
    const verdict = moderateText([
      { name: "message", value: "This is a shit situation" },
    ]);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "profanity"));
  });

  it("detects leet-speak profanity", () => {
    const verdict = moderateText([
      { name: "message", value: "You are an @$$h0l3" },
    ]);
    // "asshole" after leet normalization
    assert.equal(verdict.flagged, true);
  });

  it("flags excessive URLs", () => {
    const verdict = moderateText([
      { name: "bio", value: "Check out https://a.com and https://b.com and https://c.com for my work" },
    ]);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "spam_urls"));
  });

  it("flags repeated characters", () => {
    const verdict = moderateText([
      { name: "message", value: "Hellooooooooo there" },
    ]);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "spam_repeated_chars"));
  });

  it("flags ALL CAPS text over 20 chars", () => {
    const verdict = moderateText([
      { name: "message", value: "THIS IS ALL CAPS AND IT IS VERY LOUD" },
    ]);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "spam_all_caps"));
  });

  it("does not flag short ALL CAPS text", () => {
    const verdict = moderateText([
      { name: "title", value: "BOLD" },
    ]);
    const capsReason = verdict.reasons.find((r) => r.rule === "spam_all_caps");
    assert.equal(capsReason, undefined);
  });

  it("flags phone numbers in non-email fields", () => {
    const verdict = moderateText([
      { name: "bio", value: "Call me at 0412 345 678 for commissions" },
    ]);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "contact_info_phone"));
  });

  it("flags email addresses in non-email fields", () => {
    const verdict = moderateText([
      { name: "message", value: "Email me at artist@example.com instead" },
    ]);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "contact_info_email"));
  });

  it("flags placeholder content", () => {
    const verdict = moderateText([
      { name: "bio", value: "test" },
    ]);
    assert.equal(verdict.flagged, true);
    assert.ok(verdict.reasons.some((r) => r.rule === "placeholder_content"));
  });

  it("does not flag legitimate short text", () => {
    const verdict = moderateText([
      { name: "name", value: "Mia" },
    ]);
    assert.equal(verdict.flagged, false);
  });

  it("skips empty and null values", () => {
    const verdict = moderateText([
      { name: "bio", value: "" },
      { name: "name", value: "   " },
    ]);
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.flagged, false);
  });

  it("does not false-positive on words containing flagged substrings", () => {
    const verdict = moderateText([
      { name: "bio", value: "I create classic assessment pieces" },
    ]);
    // "ass" is in the flag list but should only match on word boundaries
    assert.equal(verdict.flagged, false);
  });
});
