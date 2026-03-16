import { initSharedPage } from "./shared-nav.js";
import { hydrateDB } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { apiRequest } from "./api-client.js";
import { byId, escapeHtml, formatDate, showToast, toTitle } from "./utils.js";

initSharedPage();
await hydrateDB();

const loading = byId("admin-loading");
const shell = byId("admin-shell");
const denied = byId("admin-denied");

function showDenied() {
  loading.hidden = true;
  denied.hidden = false;
}

function showShell() {
  loading.hidden = true;
  shell.hidden = false;
}

// ─── Reports ───────────────────────────────────────────────────────────────

let reportsNextCursor = null;
const reportsListEl = byId("reports-list");
const reportsStatsEl = byId("report-stats");
const reportsLoadMoreWrap = byId("reports-load-more-wrap");
const reportsLoadMoreBtn = byId("reports-load-more-btn");
const reportsReloadBtn = byId("reports-reload-btn");
const reportFilterStatus = byId("report-filter-status");
const reportFilterType = byId("report-filter-type");

const REPORT_STATUS_LABELS = {
  open: "Open",
  reviewing: "Reviewing",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const REPORT_STATUS_CLASSES = {
  open: "status-pending",
  reviewing: "status-draft",
  resolved: "status-live",
  dismissed: "status-unknown",
};

async function loadReportsSection(cursor = null) {
  if (!cursor) {
    reportsNextCursor = null;
    if (reportsListEl) reportsListEl.innerHTML = `<p class="section-copy">Loading…</p>`;
    if (reportsLoadMoreWrap) reportsLoadMoreWrap.hidden = true;
  }

  const params = new URLSearchParams({ limit: "20" });
  const status = reportFilterStatus?.value;
  const type = reportFilterType?.value;
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await apiRequest(`/v1/admin/reports?${params}`);
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to load reports.");

    const { items, summary, pagination } = res.data;
    reportsNextCursor = pagination?.nextCursor || null;

    if (reportsStatsEl && summary?.byStatus) {
      const s = summary.byStatus;
      reportsStatsEl.innerHTML = [
        { label: "Open", value: s.open || 0 },
        { label: "Reviewing", value: s.reviewing || 0 },
        { label: "Resolved", value: s.resolved || 0 },
        { label: "Dismissed", value: s.dismissed || 0 },
      ]
        .map(
          (stat) => `
          <div class="home-hero-stat">
            <strong>${escapeHtml(String(stat.value))}</strong>
            <span>${escapeHtml(stat.label)}</span>
          </div>
        `,
        )
        .join("");
    }

    if (!cursor && reportsListEl) reportsListEl.innerHTML = "";

    if (!items?.length && !cursor) {
      if (reportsListEl) {
        reportsListEl.innerHTML = `<article class="empty-state"><p>No reports match this filter.</p></article>`;
      }
    } else {
      renderReportItems(items || []);
    }

    if (reportsLoadMoreWrap) reportsLoadMoreWrap.hidden = !reportsNextCursor;
  } catch (err) {
    if (reportsListEl && !cursor) {
      reportsListEl.innerHTML = `<p class="section-copy" style="color:var(--color-error);">${escapeHtml(err?.message || "Failed to load reports.")}</p>`;
    } else {
      showToast(err?.message || "Failed to load more reports.", "error");
    }
  }
}

function renderReportItems(items) {
  if (!reportsListEl) return;
  for (const report of items) {
    const item = document.createElement("article");
    item.className = "collection-item workspace-item";
    item.setAttribute("role", "listitem");

    const statusClass = REPORT_STATUS_CLASSES[report.status] || "status-unknown";
    const statusLabel = REPORT_STATUS_LABELS[report.status] || toTitle(report.status || "unknown");

    const isSystem = report.reportedById === "system_automod";
    const sourceBadge = isSystem
      ? `<span class="status-badge status-draft" style="margin-left:0.4rem;font-size:0.7rem;">System</span>`
      : "";

    const meta = report.metadata || {};
    const reasonsHtml = isSystem && Array.isArray(meta.moderationReasons)
      ? `<ul style="margin:0.25rem 0 0 1rem;font-size:0.85rem;opacity:0.8;">${meta.moderationReasons.map(
          (r) => `<li>${escapeHtml(r.detail)} <em>(${escapeHtml(r.rule)})</em></li>`
        ).join("")}</ul>`
      : "";
    const snapshotHtml = isSystem && meta.contentSnapshot
      ? `<details style="margin-top:0.35rem;"><summary style="font-size:0.85rem;cursor:pointer;">Content snapshot</summary><pre style="white-space:pre-wrap;font-size:0.8rem;background:var(--surface-raised);padding:0.5rem;border-radius:6px;margin-top:0.25rem;">${escapeHtml(String(meta.contentSnapshot))}</pre></details>`
      : "";

    item.innerHTML = `
      <div class="workspace-item-header">
        <div>
          <h4>Report: ${escapeHtml(toTitle(report.type || "unknown"))}${sourceBadge}</h4>
          <p class="workspace-item-meta">
            <span class="status-badge ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
            <span style="margin-left:0.5rem;opacity:0.6;">Target: ${escapeHtml(report.targetId || "—")}</span>
          </p>
        </div>
        <p class="workspace-item-date">${formatDate(report.updatedAt)}</p>
      </div>
      ${report.note ? `<p class="workspace-item-meta" style="margin-top:0.25rem;">${escapeHtml(report.note)}</p>` : ""}
      ${reasonsHtml}
      ${snapshotHtml}
      <div class="form-actions" style="margin-top:0.75rem;flex-wrap:wrap;gap:0.4rem;">
        ${meta.handler && report.status !== "resolved" ? `<button class="btn btn-outline btn-small" data-report-id="${escapeHtml(report.id)}" data-reset-content style="color:var(--color-error);border-color:var(--color-error);">Reset content</button>` : ""}
        ${report.status !== "resolved" ? `<button class="btn btn-outline btn-small" data-report-id="${escapeHtml(report.id)}" data-report-action="resolved" data-report-note="Reviewed and resolved — no further action needed.">Resolve</button>` : ""}
        ${report.status !== "dismissed" ? `<button class="btn btn-ghost btn-small" data-report-id="${escapeHtml(report.id)}" data-report-action="dismissed" data-report-note="Dismissed — does not violate platform guidelines.">Dismiss</button>` : ""}
        ${report.status === "resolved" || report.status === "dismissed" ? `<button class="btn btn-ghost btn-small" data-report-id="${escapeHtml(report.id)}" data-report-action="reviewing" data-report-note="Reopened for review.">Reopen</button>` : ""}
      </div>
    `;

    reportsListEl.appendChild(item);
  }
}

reportsListEl?.addEventListener("click", async (e) => {
  // Reset content button
  const resetBtn = e.target.closest("[data-reset-content]");
  if (resetBtn) {
    const reportId = resetBtn.dataset.reportId;
    if (!reportId) return;

    resetBtn.disabled = true;
    resetBtn.textContent = "Resetting…";

    try {
      const res = await apiRequest(`/v1/admin/reports/${encodeURIComponent(reportId)}/reset-content`, { method: "POST" });
      if (!res?.ok) throw new Error(res?.error?.message || "Failed to reset content.");
      const fields = res.data?.resetFields?.join(", ") || "content";
      showToast(`Cleared ${fields} and resolved report.`, "success");
      await loadReportsSection();
    } catch (err) {
      showToast(err?.message || "Failed to reset content.", "error");
      resetBtn.disabled = false;
      resetBtn.textContent = "Reset content";
    }
    return;
  }

  // Status change buttons
  const btn = e.target.closest("[data-report-action]");
  if (!btn) return;

  const reportId = btn.dataset.reportId;
  const newStatus = btn.dataset.reportAction;
  const templateNote = btn.dataset.reportNote || "";
  if (!reportId || !newStatus) return;

  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Saving…";

  try {
    const res = await apiRequest(`/v1/admin/reports/${encodeURIComponent(reportId)}/status`, {
      method: "POST",
      body: { status: newStatus, ...(templateNote ? { note: templateNote } : {}) },
    });
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to update report.");
    showToast(`Report marked as ${newStatus}.`, "success");
    await loadReportsSection();
  } catch (err) {
    showToast(err?.message || "Failed to update report.", "error");
    btn.disabled = false;
    btn.textContent = origText;
  }
});

reportFilterStatus?.addEventListener("change", () => loadReportsSection());
reportFilterType?.addEventListener("change", () => loadReportsSection());
reportsReloadBtn?.addEventListener("click", () => loadReportsSection());
reportsLoadMoreBtn?.addEventListener("click", () => loadReportsSection(reportsNextCursor));

// ─── Users ─────────────────────────────────────────────────────────────────

let usersNextCursor = null;
const usersListEl = byId("users-list");
const usersStatsEl = byId("user-stats");
const usersLoadMoreWrap = byId("users-load-more-wrap");
const usersLoadMoreBtn = byId("users-load-more-btn");
const usersReloadBtn = byId("users-reload-btn");

async function loadUsersSection(cursor = null) {
  if (!cursor) {
    usersNextCursor = null;
    if (usersListEl) usersListEl.innerHTML = `<p class="section-copy">Loading…</p>`;
    if (usersLoadMoreWrap) usersLoadMoreWrap.hidden = true;
  }

  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await apiRequest(`/v1/admin/platform/users?${params}`);
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to load users.");

    const { items, summary, pagination } = res.data;
    usersNextCursor = pagination?.nextCursor || null;

    if (usersStatsEl && summary) {
      usersStatsEl.innerHTML = [
        { label: "Total users", value: summary.total },
        { label: "Active", value: summary.active },
        { label: "Deleted", value: summary.deleted },
      ]
        .map(
          (s) => `
          <div class="home-hero-stat">
            <strong>${escapeHtml(String(s.value))}</strong>
            <span>${escapeHtml(s.label)}</span>
          </div>
        `,
        )
        .join("");
    }

    if (!cursor && usersListEl) usersListEl.innerHTML = "";

    if (!items?.length && !cursor) {
      if (usersListEl) {
        usersListEl.innerHTML = `<article class="empty-state"><p>No users found.</p></article>`;
      }
    } else {
      renderUserItems(items || []);
    }

    if (usersLoadMoreWrap) usersLoadMoreWrap.hidden = !usersNextCursor;
  } catch (err) {
    if (usersListEl && !cursor) {
      usersListEl.innerHTML = `<p class="section-copy" style="color:var(--color-error);">${escapeHtml(err?.message || "Failed to load users.")}</p>`;
    } else {
      showToast(err?.message || "Failed to load more users.", "error");
    }
  }
}

function renderUserItems(items) {
  if (!usersListEl) return;
  for (const user of items) {
    const item = document.createElement("article");
    item.className = "collection-item workspace-item";
    item.setAttribute("role", "listitem");

    const statusBadgeHtml = user.deleted
      ? `<span class="status-badge status-unknown">Deleted</span>`
      : `<span class="status-badge status-live">Active</span>`;

    item.innerHTML = `
      <div class="workspace-item-header">
        <div>
          <h4>${escapeHtml(user.name || "Unnamed user")}</h4>
          <p class="workspace-item-meta">
            ${statusBadgeHtml}
            <span style="margin-left:0.5rem;opacity:0.6;">${escapeHtml(user.email || "—")}</span>
          </p>
        </div>
        <p class="workspace-item-date">${formatDate(user.createdAt)}</p>
      </div>
      ${user.location ? `<p class="workspace-item-meta" style="margin-top:0.25rem;">${escapeHtml(user.location)}</p>` : ""}
    `;

    usersListEl.appendChild(item);
  }
}

usersReloadBtn?.addEventListener("click", () => loadUsersSection());
usersLoadMoreBtn?.addEventListener("click", () => loadUsersSection(usersNextCursor));

// ─── Auth / access check ────────────────────────────────────────────────────

if (!isCognitoAuthenticated()) {
  const next = encodeURIComponent(window.location.pathname);
  window.location.href = `/account-settings.html?next=${next}`;
} else {
  let accessGranted = false;
  try {
    const probe = await apiRequest("/v1/admin/reports?limit=1");
    if (!probe?.ok) throw Object.assign(new Error("not ok"), { statusCode: 0 });
    accessGranted = true;
  } catch (err) {
    if (err?.statusCode === 403 || err?.statusCode === 401) {
      showDenied();
    } else {
      accessGranted = true;
    }
  }

  if (accessGranted) {
    showShell();
    await loadReportsSection();
    await loadUsersSection();
  }
}
