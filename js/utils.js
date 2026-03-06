export function byId(id) {
  return document.getElementById(id);
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function getQueryParam(name, url = window.location.search) {
  return new URLSearchParams(url).get(name);
}

export function normalizeInternalPath(candidate, fallbackPath = "/") {
  const fallback = String(fallbackPath || "/");
  const raw = String(candidate || "").trim();
  if (!raw) {
    return fallback;
  }

  try {
    const resolved = new URL(raw, window.location.origin);
    if (resolved.origin !== window.location.origin) {
      return fallback;
    }
    if (!resolved.pathname.startsWith("/")) {
      return fallback;
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch (_) {
    return fallback;
  }
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function toTitle(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sanitizeClassToken(value, fallback = "unknown") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function sanitizeImageUrl(value, fallbackUrl) {
  const raw = String(value || "").trim();
  if (!raw) {
    return String(fallbackUrl || "");
  }

  if (raw.startsWith("data:image/")) {
    return raw;
  }

  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (_) {
    return String(fallbackUrl || "");
  }

  return String(fallbackUrl || "");
}

function ensureToastRoot() {
  let root = qs(".toast-root");
  if (!root) {
    root = document.createElement("div");
    root.className = "toast-root";
    document.body.append(root);
  }
  return root;
}

export function showToast(message, type = "info") {
  const root = ensureToastRoot();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  root.append(toast);

  window.setTimeout(() => {
    toast.classList.add("is-visible");
  }, 10);

  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 200);
  }, 2800);
}

export function statusBadge(status) {
  const safeClass = sanitizeClassToken(status, "unknown");
  const safeText = escapeHtml(toTitle(safeClass.replaceAll("-", "_")));
  return `<span class="status-badge status-${safeClass}">${safeText}</span>`;
}
