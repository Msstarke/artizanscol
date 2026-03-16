import { initSharedPage } from "./shared-nav.js";
import { hydrateDB } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { apiRequest } from "./api-client.js";
import { byId, escapeHtml, showToast } from "./utils.js";

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

// ─── State ──────────────────────────────────────────────────────────────────

let customBlockWords = [];
let customFlagWords = [];

const builtinBlockEl = byId("builtin-block-words");
const builtinFlagEl = byId("builtin-flag-words");
const customBlockEl = byId("custom-block-words");
const customFlagEl = byId("custom-flag-words");
const addBlockForm = byId("add-block-word-form");
const addBlockInput = byId("add-block-word-input");
const addFlagForm = byId("add-flag-word-form");
const addFlagInput = byId("add-flag-word-input");

// ─── Render ─────────────────────────────────────────────────────────────────

function renderWordTags(container, words, opts = {}) {
  if (!container) return;
  if (!words.length) {
    container.innerHTML = `<span style="opacity:0.5;font-size:0.85rem;">None</span>`;
    return;
  }
  container.innerHTML = words
    .map((word) => {
      const removeBtn = opts.removable
        ? ` <button type="button" data-remove-word="${escapeHtml(word)}" data-list="${escapeHtml(opts.list || "")}" style="background:none;border:none;cursor:pointer;opacity:0.6;font-size:0.75rem;padding:0 0.15rem;">&times;</button>`
        : "";
      return `<span class="status-badge ${escapeHtml(opts.badgeClass || "status-unknown")}" style="font-size:0.8rem;padding:0.2rem 0.5rem;">${escapeHtml(word)}${removeBtn}</span>`;
    })
    .join("");
}

function renderAll(data) {
  renderWordTags(builtinBlockEl, data.builtIn.blockWords, { badgeClass: "status-unknown" });
  renderWordTags(builtinFlagEl, data.builtIn.flagWords, { badgeClass: "status-draft" });
  renderWordTags(customBlockEl, data.custom.customBlockWords, { removable: true, list: "block", badgeClass: "status-unknown" });
  renderWordTags(customFlagEl, data.custom.customFlagWords, { removable: true, list: "flag", badgeClass: "status-draft" });

  customBlockWords = [...data.custom.customBlockWords];
  customFlagWords = [...data.custom.customFlagWords];
}

// ─── Load ───────────────────────────────────────────────────────────────────

async function loadModerationConfig() {
  try {
    const res = await apiRequest("/v1/admin/moderation/config");
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to load config.");
    renderAll(res.data);
  } catch (err) {
    showToast(err?.message || "Failed to load moderation config.", "error");
  }
}

// ─── Save ───────────────────────────────────────────────────────────────────

async function saveConfig() {
  try {
    const res = await apiRequest("/v1/admin/moderation/config", {
      method: "PATCH",
      body: { customBlockWords, customFlagWords },
    });
    if (!res?.ok) throw new Error(res?.error?.message || "Failed to save.");
    renderAll(res.data);
    showToast("Moderation config saved.", "success");
  } catch (err) {
    showToast(err?.message || "Failed to save moderation config.", "error");
  }
}

// ─── Add word ───────────────────────────────────────────────────────────────

addBlockForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = addBlockInput?.value?.trim().toLowerCase();
  if (!word) return;
  if (customBlockWords.includes(word)) {
    showToast("Word already in block list.", "info");
    return;
  }
  customBlockWords.push(word);
  if (addBlockInput) addBlockInput.value = "";
  await saveConfig();
});

addFlagForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = addFlagInput?.value?.trim().toLowerCase();
  if (!word) return;
  if (customFlagWords.includes(word)) {
    showToast("Word already in flag list.", "info");
    return;
  }
  customFlagWords.push(word);
  if (addFlagInput) addFlagInput.value = "";
  await saveConfig();
});

// ─── Remove word ────────────────────────────────────────────────────────────

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-remove-word]");
  if (!btn) return;

  const word = btn.dataset.removeWord;
  const list = btn.dataset.list;

  if (list === "block") {
    customBlockWords = customBlockWords.filter((w) => w !== word);
  } else if (list === "flag") {
    customFlagWords = customFlagWords.filter((w) => w !== word);
  }

  await saveConfig();
});

// ─── Auth / access check ────────────────────────────────────────────────────

if (!isCognitoAuthenticated()) {
  const next = encodeURIComponent(window.location.pathname);
  window.location.href = `/account-settings.html?next=${next}`;
} else {
  let accessGranted = false;
  try {
    const probe = await apiRequest("/v1/admin/moderation/config");
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
    await loadModerationConfig();
  }
}
