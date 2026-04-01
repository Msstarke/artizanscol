import { initSharedPage } from "./shared-nav.js";
import { hydrateDB, getDB } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { apiRequest } from "./api-client.js";
import { byId, escapeHtml, formatDate, showToast, statusBadge } from "./utils.js";

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

// ─── Artist review ─────────────────────────────────────────────────────────

let artistNextCursor = null;
const artistFilterEl = byId("artist-filter-verified");
const artistListEl = byId("artist-review-list");
const artistStatsEl = byId("artist-review-stats");
const artistLoadMoreWrap = byId("artist-load-more-wrap");
const artistLoadMoreBtn = byId("artist-load-more-btn");
const artistReloadBtn = byId("artist-reload-btn");

async function loadArtistReviewSection(cursor = null) {
  if (!cursor) {
    artistNextCursor = null;
    if (artistListEl) artistListEl.innerHTML = `<p class="section-copy">Loading…</p>`;
    if (artistLoadMoreWrap) artistLoadMoreWrap.hidden = true;
  }

  const verifiedFilter = artistFilterEl?.value;
  const params = new URLSearchParams({ limit: "20" });
  if (verifiedFilter) params.set("verified", verifiedFilter);
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await apiRequest(`/v1/admin/artists/review?${params}`);
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to load artists.");

    const { items, summary, pagination } = res.data;
    artistNextCursor = pagination?.nextCursor || null;

    if (artistStatsEl && summary) {
      artistStatsEl.innerHTML = [
        { label: "Total artists", value: summary.total },
        { label: "Verified", value: summary.verified },
        { label: "Unverified", value: summary.pending },
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

    if (!cursor && artistListEl) artistListEl.innerHTML = "";

    if (!items?.length && !cursor) {
      if (artistListEl) {
        artistListEl.innerHTML = `
          <article class="empty-state">
            <p>No artists match this filter.</p>
          </article>
        `;
      }
    } else {
      renderArtistItems(items || []);
    }

    if (artistLoadMoreWrap) artistLoadMoreWrap.hidden = !artistNextCursor;
  } catch (err) {
    if (artistListEl && !cursor) {
      artistListEl.innerHTML = `<p class="section-copy" style="color:var(--color-error);">${escapeHtml(err?.message || "Failed to load artists.")}</p>`;
    } else {
      showToast(err?.message || "Failed to load more artists.", "error");
    }
  }
}

function renderArtistItems(items) {
  if (!artistListEl) return;
  for (const artist of items) {
    const item = document.createElement("article");
    item.className = "collection-item workspace-item";
    item.setAttribute("role", "listitem");
    item.dataset.artistId = artist.id;

    const verifiedBadge = artist.verified
      ? `<span class="status-badge status-live">Verified</span>`
      : `<span class="status-badge status-draft">Unverified</span>`;

    item.innerHTML = `
      <div class="workspace-item-header">
        <div>
          <h4>${escapeHtml(artist.name || "Unnamed artist")}</h4>
          <p class="workspace-item-meta">
            ${verifiedBadge}
            ${artist.category ? `<span class="status-badge status-unknown">${escapeHtml(artist.category)}</span>` : ""}
            ${artist.handle ? `<span style="margin-left:0.5rem;opacity:0.6;">@${escapeHtml(artist.handle)}</span>` : ""}
          </p>
        </div>
        <p class="workspace-item-date">${formatDate(artist.updatedAt)}</p>
      </div>
      ${artist.location ? `<p class="workspace-item-meta" style="margin-top:0.25rem;">${escapeHtml(artist.location)}</p>` : ""}
      <div class="form-actions" style="margin-top:0.75rem;">
        <a class="btn btn-ghost btn-small" href="/artist-preview.html?id=${encodeURIComponent(artist.id)}" target="_blank" rel="noopener">View profile</a>
        ${
          artist.verified
            ? `<button class="btn btn-outline btn-small" type="button" data-action="reject" data-artist-id="${escapeHtml(artist.id)}">Remove verification</button>`
            : `<button class="btn btn-primary btn-small" type="button" data-action="verify" data-artist-id="${escapeHtml(artist.id)}">Verify artist</button>
               <button class="btn btn-outline btn-small" type="button" data-action="reject" data-artist-id="${escapeHtml(artist.id)}">Reject</button>`
        }
        <button class="btn btn-ghost btn-small" type="button" data-action="clear-portfolio" data-artist-id="${escapeHtml(artist.id)}" style="color:var(--color-error);">Clear portfolio</button>
        <button class="btn btn-ghost btn-small" type="button" data-action="flag-ai" data-artist-id="${escapeHtml(artist.id)}" style="color:var(--color-orange);">Flag as AI</button>
      </div>
    `;

    artistListEl.appendChild(item);
  }
}

artistListEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action][data-artist-id]");
  if (!btn) return;

  const action = btn.dataset.action;
  const artistId = btn.dataset.artistId;
  if (!action || !artistId) return;

  if (action === "flag-ai") {
    if (!window.confirm("Flag this artist's content as potentially AI-generated? A report will be created for review.")) return;
    btn.disabled = true;
    btn.textContent = "Flagging…";
    try {
      const res = await apiRequest(`/v1/admin/artists/${encodeURIComponent(artistId)}/flag-ai`, { method: "POST" });
      if (!res?.ok) throw new Error(res?.error?.message || "Failed to flag.");
      showToast("Artist flagged as potentially AI-generated. Report created.", "success");
      btn.textContent = "Flagged";
    } catch (err) {
      showToast(err?.message || "Failed to flag.", "error");
      btn.disabled = false;
      btn.textContent = "Flag as AI";
    }
    return;
  }

  if (action === "clear-portfolio") {
    if (!window.confirm("Remove all portfolio items from this artist? This cannot be undone.")) return;
    btn.disabled = true;
    btn.textContent = "Clearing…";
    try {
      const res = await apiRequest(`/v1/admin/artists/${encodeURIComponent(artistId)}/clear-portfolio`, { method: "POST" });
      if (!res?.ok) throw new Error(res?.error?.message || "Failed to clear portfolio.");
      showToast("Portfolio cleared.", "success");
      await loadArtistReviewSection();
    } catch (err) {
      showToast(err?.message || "Failed to clear portfolio.", "error");
      btn.disabled = false;
      btn.textContent = "Clear portfolio";
    }
    return;
  }

  const note = action === "reject" ? (window.prompt("Rejection note (optional):") ?? "") : "";

  btn.disabled = true;
  btn.textContent = action === "verify" ? "Verifying…" : "Rejecting…";

  try {
    const res = await apiRequest(`/v1/admin/artists/${encodeURIComponent(artistId)}/${action}`, {
      method: "POST",
      body: note ? { note } : {},
    });
    if (!res?.ok) throw new Error(res?.error?.message || "Action failed.");
    showToast(`Artist ${action === "verify" ? "verified" : "rejected"}.`, "success");
    await loadArtistReviewSection();
  } catch (err) {
    showToast(err?.message || "Action failed.", "error");
    btn.disabled = false;
    btn.textContent = action === "verify" ? "Verify artist" : "Reject";
  }
});

artistFilterEl?.addEventListener("change", () => loadArtistReviewSection());
artistReloadBtn?.addEventListener("click", () => loadArtistReviewSection());
artistLoadMoreBtn?.addEventListener("click", () => loadArtistReviewSection(artistNextCursor));

// ─── Categories ────────────────────────────────────────────────────────────

const categoriesListEl = byId("categories-list");
const categoriesReloadBtn = byId("categories-reload-btn");

async function loadCategoriesSection() {
  if (categoriesListEl) categoriesListEl.innerHTML = `<p class="section-copy">Loading categories…</p>`;

  const db = getDB();
  const categories = db?.categories || [];

  if (!categories.length) {
    if (categoriesListEl) {
      categoriesListEl.innerHTML = `<article class="empty-state"><p>No categories found.</p></article>`;
    }
    return;
  }

  renderCategories(categories);
}

function renderCategories(categories) {
  if (!categoriesListEl) return;
  categoriesListEl.innerHTML = "";

  const sorted = [...categories].sort((a, b) =>
    String(a.sortName || a.name || "").localeCompare(String(b.sortName || b.name || "")),
  );

  for (const cat of sorted) {
    const item = document.createElement("article");
    item.className = "collection-item workspace-item";
    item.setAttribute("role", "listitem");
    item.dataset.categoryId = cat.id;

    const activeBadge = cat.active
      ? `<span class="status-badge status-live">Active</span>`
      : `<span class="status-badge status-draft">Inactive</span>`;

    item.innerHTML = `
      <div class="workspace-item-header">
        <div>
          <h4>${escapeHtml(cat.name || cat.id)}</h4>
          <p class="workspace-item-meta">${activeBadge}</p>
        </div>
        <div class="form-actions">
          <button
            class="btn btn-outline btn-small"
            type="button"
            data-category-id="${escapeHtml(cat.id)}"
            data-category-active="${cat.active ? "true" : "false"}"
          >${cat.active ? "Deactivate" : "Activate"}</button>
        </div>
      </div>
    `;

    categoriesListEl.appendChild(item);
  }
}

categoriesListEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-category-id]");
  if (!btn) return;

  const categoryId = btn.dataset.categoryId;
  const currentlyActive = btn.dataset.categoryActive === "true";
  const nextActive = !currentlyActive;

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const res = await apiRequest(`/v1/admin/platform/categories/${encodeURIComponent(categoryId)}`, {
      method: "PATCH",
      body: { active: nextActive },
    });
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to update category.");
    showToast(`Category ${nextActive ? "activated" : "deactivated"}.`, "success");

    btn.dataset.categoryActive = String(nextActive);
    btn.textContent = nextActive ? "Deactivate" : "Activate";
    btn.disabled = false;

    // Update badge in the item
    const item = btn.closest("[data-category-id]") || btn.closest(".collection-item");
    const badge = item?.querySelector(".status-badge");
    if (badge) {
      badge.className = nextActive ? "status-badge status-live" : "status-badge status-draft";
      badge.textContent = nextActive ? "Active" : "Inactive";
    }
  } catch (err) {
    showToast(err?.message || "Failed to update category.", "error");
    btn.disabled = false;
    btn.textContent = currentlyActive ? "Deactivate" : "Activate";
  }
});

categoriesReloadBtn?.addEventListener("click", () => loadCategoriesSection());

// ─── Auth / access check ────────────────────────────────────────────────────

if (!isCognitoAuthenticated()) {
  const next = encodeURIComponent(window.location.pathname);
  window.location.href = `/account-settings.html?next=${next}`;
} else {
  let accessGranted = false;
  try {
    const probe = await apiRequest("/v1/admin/artists/review?limit=1");
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
    await loadArtistReviewSection();
    await loadCategoriesSection();
  }
}
