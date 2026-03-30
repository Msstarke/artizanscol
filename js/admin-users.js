import { initSharedPage } from "./shared-nav.js";
import { hydrateDB } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { apiRequest } from "./api-client.js";
import { byId, escapeHtml, formatDate, showToast } from "./utils.js";

initSharedPage();
await hydrateDB();

const loading = byId("admin-loading");
const shell = byId("admin-shell");
const denied = byId("admin-denied");

// ─── State ─────────────────────────────────────────────────────────────────

let allUsers = [];
let nextCursor = null;

const usersListEl = byId("users-list");
const userStatsEl = byId("user-stats");
const loadMoreWrap = byId("users-load-more-wrap");
const loadMoreBtn = byId("users-load-more-btn");
const reloadBtn = byId("users-reload-btn");
const filterStatusEl = byId("user-filter-status");
const searchEl = byId("user-search");

// ─── Auth / access check ────────────────────────────────────────────────────

function showDenied() {
  loading.hidden = true;
  denied.hidden = false;
}

function showShell() {
  loading.hidden = true;
  shell.hidden = false;
}

if (!isCognitoAuthenticated()) {
  const next = encodeURIComponent(window.location.pathname);
  window.location.href = `/account-settings.html?next=${next}`;
} else {
  let accessGranted = false;
  try {
    const probe = await apiRequest("/v1/admin/platform/users?limit=1");
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
    await loadUsers();
  }
}

// ─── Load ───────────────────────────────────────────────────────────────────

async function loadUsers(cursor = null) {
  if (!cursor) {
    allUsers = [];
    nextCursor = null;
    if (usersListEl) usersListEl.innerHTML = `<p class="section-copy">Loading…</p>`;
    if (loadMoreWrap) loadMoreWrap.hidden = true;
  }

  const params = new URLSearchParams({ limit: "100" });
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await apiRequest(`/v1/admin/platform/users?${params}`);
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to load users.");

    const { items, summary, pagination } = res.data;
    nextCursor = pagination?.nextCursor || null;
    allUsers = cursor ? [...allUsers, ...(items || [])] : (items || []);

    if (userStatsEl && summary) {
      userStatsEl.innerHTML = [
        { label: "Total", value: summary.total },
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

    renderFiltered();

    if (loadMoreWrap) loadMoreWrap.hidden = !nextCursor;
  } catch (err) {
    if (usersListEl && !cursor) {
      usersListEl.innerHTML = `<p class="section-copy" style="color:var(--color-error);">${escapeHtml(err?.message || "Failed to load users.")}</p>`;
    } else {
      showToast(err?.message || "Failed to load more users.", "error");
    }
  }
}

// ─── Render ─────────────────────────────────────────────────────────────────

function renderFiltered() {
  if (!usersListEl) return;

  const statusFilter = filterStatusEl?.value || "";
  const search = String(searchEl?.value || "").trim().toLowerCase();

  const filtered = allUsers.filter((user) => {
    if (statusFilter === "active" && user.deleted) return false;
    if (statusFilter === "deleted" && !user.deleted) return false;
    if (search) {
      const name = String(user.name || "").toLowerCase();
      const email = String(user.email || "").toLowerCase();
      if (!name.includes(search) && !email.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    usersListEl.innerHTML = `<article class="empty-state"><p>No users match this filter.</p></article>`;
    return;
  }

  usersListEl.innerHTML = "";

  for (const user of filtered) {
    const item = document.createElement("article");
    item.className = `collection-item workspace-item${user.deleted ? " is-unread" : ""}`;
    item.setAttribute("role", "listitem");

    const statusBadge = user.deleted
      ? `<span class="status-badge status-unknown">Deleted</span>`
      : `<span class="status-badge status-live">Active</span>`;

    item.innerHTML = `
      <div class="workspace-item-header">
        <div>
          <h4>${escapeHtml(user.name || "Unnamed user")}</h4>
          <p class="workspace-item-meta">
            ${statusBadge}
            <span style="margin-left:0.5rem;opacity:0.7;">${escapeHtml(user.email || "—")}</span>
          </p>
          ${user.location ? `<p class="workspace-item-meta" style="margin-top:0.2rem;opacity:0.6;">${escapeHtml(user.location)}</p>` : ""}
        </div>
        <div style="text-align:right;">
          <p class="workspace-item-date">Joined ${formatDate(user.createdAt)}</p>
          <div class="form-actions" style="margin-top:0.5rem;justify-content:flex-end;flex-wrap:wrap;gap:0.3rem;">
            <button class="btn btn-ghost btn-small" type="button" data-user-id="${escapeHtml(user.id)}" data-action="reset-bio">Reset bio</button>
            <button class="btn btn-ghost btn-small" type="button" data-user-id="${escapeHtml(user.id)}" data-action="reset-name">Reset name</button>
            ${
              user.deleted
                ? `<button class="btn btn-outline btn-small" type="button" data-user-id="${escapeHtml(user.id)}" data-action="restore">Restore</button>`
                : `<button class="btn btn-outline btn-small" type="button" data-user-id="${escapeHtml(user.id)}" data-action="delete" style="color:var(--color-error);border-color:var(--color-error);">Suspend</button>`
            }
            <button class="btn btn-ghost btn-small" type="button" data-user-id="${escapeHtml(user.id)}" data-action="hard-delete" style="color:var(--color-error);">Hard delete</button>
          </div>
        </div>
      </div>
    `;

    usersListEl.appendChild(item);
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

usersListEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-user-id][data-action]");
  if (!btn) return;

  const userId = btn.dataset.userId;
  const action = btn.dataset.action;
  if (!userId || !action) return;

  // Reset bio / name
  if (action === "reset-bio" || action === "reset-name") {
    const field = action === "reset-bio" ? "bio" : "name";
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = "Resetting…";

    try {
      const body = action === "reset-bio" ? { resetBio: true } : { resetName: true };
      const res = await apiRequest(`/v1/admin/platform/users/${encodeURIComponent(userId)}/reset-fields`, {
        method: "POST",
        body,
      });
      if (!res?.ok) throw new Error(res?.error?.message || "Failed to reset.");
      showToast(`User ${field} has been cleared.`, "success");

      if (action === "reset-name") {
        const idx = allUsers.findIndex((u) => u.id === userId);
        if (idx >= 0) allUsers[idx] = { ...allUsers[idx], name: "" };
        renderFiltered();
      }
    } catch (err) {
      showToast(err?.message || "Failed to reset field.", "error");
    }
    btn.disabled = false;
    btn.textContent = origText;
    return;
  }

  // Hard delete
  if (action === "hard-delete") {
    const confirmed = window.confirm(
      "PERMANENTLY delete this user and their artist profile? This cannot be undone.",
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = "Deleting…";

    try {
      const res = await apiRequest(`/v1/admin/platform/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      if (!res?.ok) throw new Error(res?.error?.message || "Hard delete failed.");

      allUsers = allUsers.filter((u) => u.id !== userId);
      showToast("User permanently deleted.", "success");
      renderFiltered();
    } catch (err) {
      showToast(err?.message || "Hard delete failed.", "error");
      btn.disabled = false;
      btn.textContent = "Hard delete";
    }
    return;
  }

  const isDelete = action === "delete";

  if (isDelete) {
    const confirmed = window.confirm(
      "Soft-delete this user? They will be blocked from the platform but their data is retained. You can restore them at any time.",
    );
    if (!confirmed) return;
  }

  btn.disabled = true;
  btn.textContent = isDelete ? "Deleting…" : "Restoring…";

  try {
    const res = await apiRequest(`/v1/admin/platform/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { deleted: isDelete },
    });
    if (!res?.ok) throw new Error(res?.error?.message || "Action failed.");

    // Update in-place so we don't need a full reload
    const idx = allUsers.findIndex((u) => u.id === userId);
    if (idx >= 0) allUsers[idx] = { ...allUsers[idx], deleted: isDelete };

    showToast(isDelete ? "User deleted." : "User restored.", "success");
    renderFiltered();
  } catch (err) {
    showToast(err?.message || "Action failed.", "error");
    btn.disabled = false;
    btn.textContent = isDelete ? "Delete user" : "Restore";
  }
});

// ─── Filters ────────────────────────────────────────────────────────────────

filterStatusEl?.addEventListener("change", renderFiltered);
searchEl?.addEventListener("input", renderFiltered);
reloadBtn?.addEventListener("click", () => loadUsers());
loadMoreBtn?.addEventListener("click", () => loadUsers(nextCursor));
