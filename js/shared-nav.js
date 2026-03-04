import { getDB, resetDB } from "./store.js";
import { getSession, getRoleHome, logout } from "./session.js";
import { signOutCognito } from "./cognito-auth.js";
import { qsa, showToast } from "./utils.js";

function setRoleText(session) {
  const roleText = (() => {
    if (!session.cognitoEmail) {
      return "Session: signed out";
    }
    if (session.role === "none") {
      return `Signed in: ${session.cognitoEmail}`;
    }
    return `Role: ${session.role}`;
  })();

  qsa("[data-role-chip]").forEach((node) => {
    node.textContent = roleText;
  });

  qsa("[data-role-summary]").forEach((node) => {
    node.textContent = session.role === "none" ? "none" : session.role;
  });
}

function setAuthLinks(session) {
  qsa("[data-auth-link]").forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    node.href = "/account-settings.html";
    node.textContent = "Account Settings";
  });

  qsa("[data-role-home]").forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    node.href = getRoleHome(session.role);
  });
}

function markActiveLinks() {
  const path = window.location.pathname;

  qsa(".main-nav a, .side-nav a").forEach((link) => {
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }

    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#")) {
      return;
    }

    const url = new URL(href, window.location.origin);
    const isActive = path === url.pathname;
    link.classList.toggle("is-active", isActive);
  });
}

function mountMaintenanceBanner(db, session) {
  const existing = document.querySelector(".maintenance-banner");
  if (existing) {
    existing.remove();
  }

  if (!db.system.maintenanceMode) {
    return;
  }

  const banner = document.createElement("div");
  banner.className = "maintenance-banner";
  banner.innerHTML =
    "<div class=\"container\"><strong>Maintenance mode:</strong> write actions are currently disabled.</div>";

  const header = document.querySelector(".site-header");
  if (header) {
    header.insertAdjacentElement("afterend", banner);
    return;
  }
  document.body.prepend(banner);
}

function bindGlobalButtons() {
  qsa("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await signOutCognito();
      logout();
      window.location.href = "/account-settings.html";
    });
  });

  qsa("[data-reset-db]").forEach((button) => {
    button.addEventListener("click", () => {
      resetDB();
      showToast("Local data reset.", "success");
      window.setTimeout(() => window.location.reload(), 300);
    });
  });
}

let toastBound = false;
function bindToastEvent() {
  if (toastBound) {
    return;
  }
  toastBound = true;
  window.addEventListener("artizans:toast", (event) => {
    const detail = event.detail || {};
    showToast(detail.message || "Action complete.", detail.type || "info");
  });
}

export function initSharedPage() {
  const session = getSession();
  const db = getDB();

  setRoleText(session);
  setAuthLinks(session);
  markActiveLinks();
  mountMaintenanceBanner(db, session);
  bindGlobalButtons();
  bindToastEvent();

  return { session, db };
}
