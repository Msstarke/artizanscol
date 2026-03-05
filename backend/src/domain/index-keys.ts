import type { CategoryRecord, NotificationRecord } from "./entities.js";

export function ownerReadKey(ownerId: string, read: boolean): NotificationRecord["ownerReadKey"] {
  return `${ownerId}#${read ? "read" : "unread"}`;
}

export function categoryActiveStatus(active: boolean): CategoryRecord["activeStatus"] {
  return active ? "active" : "inactive";
}

export function categorySortName(name: string): CategoryRecord["sortName"] {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
