import type { ReportRecord } from "../domain/entities.js";

/** Minimal interface for creating moderation reports from any handler. */
export interface ReportWriter {
  createReport(report: ReportRecord): Promise<void>;
}

export class NoopReportWriter implements ReportWriter {
  public readonly reports: ReportRecord[] = [];
  async createReport(report: ReportRecord): Promise<void> {
    this.reports.push(report);
  }
}
