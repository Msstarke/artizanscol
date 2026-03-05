export type AuditLogEntry = {
  action: string;
  actorId: string | null;
  actorRoles?: string[];
  resourceType: string;
  resourceId?: string;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown>;
};

export function auditLog(entry: AuditLogEntry): void {
  const payload = {
    eventType: "audit",
    timestamp: new Date().toISOString(),
    action: entry.action,
    actorId: entry.actorId,
    actorRoles: entry.actorRoles || [],
    resourceType: entry.resourceType,
    resourceId: entry.resourceId || null,
    outcome: entry.outcome,
    metadata: entry.metadata || {},
  };

  // Structured logs are consumed by CloudWatch Logs Insights and SIEM forwarders.
  console.log(JSON.stringify(payload));
}
