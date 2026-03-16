import { randomUUID } from "node:crypto";
import type { ReportRecord, ReportType } from "./entities.js";
import type { ModerationVerdict } from "./content-moderation.js";
import { createRecordMeta } from "./record-meta.js";

export function buildAutoModerationReport(opts: {
  targetId: string;
  verdict: ModerationVerdict;
  handler: string;
  contentSnapshot?: string;
}): ReportRecord {
  const dominantRule = opts.verdict.reasons[0]?.rule ?? "unknown";

  const type: ReportType =
    dominantRule.startsWith("spam") || dominantRule.startsWith("contact_info")
      ? "spam"
      : "abuse";

  const meta = createRecordMeta({
    id: `rpt_${randomUUID()}`,
    createdBy: "system_automod",
  });

  return {
    ...meta,
    type,
    status: "reviewing",
    targetId: opts.targetId,
    reportedById: "system_automod",
    note: opts.verdict.reasons.map((r) => r.detail).join(" "),
    metadata: {
      moderationReasons: opts.verdict.reasons,
      handler: opts.handler,
      contentSnapshot:
        opts.contentSnapshot && opts.contentSnapshot.length > 500
          ? opts.contentSnapshot.slice(0, 500) + "…"
          : opts.contentSnapshot,
    },
  };
}
