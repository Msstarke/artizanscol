import { getDB, hydrateDB, resetDB } from "./store.js";
import { getSession, logout } from "./session.js";
import { signOutCognito } from "./cognito-auth.js";
import { qsa, showToast } from "./utils.js";

const PRIMARY_NAV_LINKS = [
  { href: "/index.html", label: "Home" },
  { href: "/explore.html", label: "Explore Artists" },
  { href: "/about.html", label: "About" },
  { href: "/contact.html", label: "Contact" },
];

const FOOTER_LINK_GROUPS = [
  {
    title: "Explore",
    links: [
      { href: "/index.html", label: "Home" },
      { href: "/explore.html", label: "Explore Artists" },
      { href: "/artist-preview.html", label: "Artist Preview" },
      { href: "/account-settings.html", label: "Workspace" },
    ],
  },
  {
    title: "Platform",
    links: [
      { href: "/about.html", label: "About" },
      { href: "/faq.html", label: "FAQ" },
      { href: "/blog.html", label: "Blog" },
      { href: "/legal.html", label: "Legal" },
    ],
  },
];

function normalizeHeaderShell() {
  const header = document.querySelector(".site-header");
  const headerInner = header?.querySelector(".header-inner");
  const nav = header?.querySelector(".main-nav");
  const actions = header?.querySelector(".header-actions");

  if (!(header instanceof HTMLElement) || !(headerInner instanceof HTMLElement)) {
    return;
  }

  if (nav instanceof HTMLElement) {
    nav.id = nav.id || "site-nav";
    nav.setAttribute("aria-label", "Main nav");
    nav.innerHTML = PRIMARY_NAV_LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`).join("");
  }

  if (actions instanceof HTMLElement) {
    actions.innerHTML = `
      <span class="role-chip" data-role-chip hidden></span>
      <a class="btn btn-outline btn-small" href="/account-settings.html" data-auth-link>Sign in</a>
      <button class="btn btn-outline btn-small" type="button" data-logout hidden>Logout</button>
    `;
  }

  if (nav instanceof HTMLElement && !headerInner.querySelector(".nav-toggle")) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", nav.id);
    toggle.setAttribute("aria-label", "Toggle navigation menu");
    toggle.innerHTML = `
      <span class="nav-toggle-label">Menu</span>
      <span class="nav-toggle-bars" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
    `;

    const target = actions instanceof HTMLElement ? actions : nav.nextSibling;
    headerInner.insertBefore(toggle, target);

    const closeNav = () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      header.classList.remove("nav-open");
    };

    toggle.addEventListener("click", () => {
      const opening = !nav.classList.contains("is-open");
      nav.classList.toggle("is-open", opening);
      toggle.setAttribute("aria-expanded", String(opening));
      header.classList.toggle("nav-open", opening);
    });

    qsa("a", nav).forEach((link) => {
      link.addEventListener("click", closeNav);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1020) {
        closeNav();
      }
    });
  }
}

function normalizeFooterShell() {
  const footerInner = document.querySelector(".site-footer .footer-inner");
  if (!(footerInner instanceof HTMLElement)) {
    return;
  }

  const year = new Date().getFullYear();
  footerInner.classList.add("footer-standard");
  footerInner.innerHTML = `
    <div class="footer-brand-block">
      <p class="footer-brand">ARTIZANS.COLLECTIVE</p>
      <p class="footer-copy">Verified human-made creative work marketplace for discovery, shortlisting, and direct hiring.</p>
      <p class="footer-meta">Copyright ${year} ARTIZANS.COLLECTIVE</p>
    </div>
    <div class="footer-link-grid">
      ${FOOTER_LINK_GROUPS.map(
        (group) => `
          <div class="footer-link-group">
            <p>${group.title}</p>
            ${group.links.map((link) => `<a href="${link.href}">${link.label}</a>`).join("")}
          </div>
        `,
      ).join("")}
    </div>
  `;
}

function setRoleText(session) {
  const signedIn = Boolean(session?.cognitoEmail);

  qsa("[data-role-chip]").forEach((node) => {
    node.hidden = !signedIn;
    node.style.display = signedIn ? "" : "none";
    node.textContent = signedIn ? "Signed in" : "";
    if (signedIn && session.cognitoEmail) {
      node.setAttribute("title", session.cognitoEmail);
    } else {
      node.removeAttribute("title");
    }
  });

  qsa("[data-role-summary]").forEach((node) => {
    node.textContent = signedIn ? "signed in" : "signed out";
  });
}

function setAuthLinks(session) {
  const signedIn = Boolean(session?.cognitoEmail);
  const label = signedIn ? "Workspace" : "Sign in";

  qsa("[data-auth-link], [data-role-home]").forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    node.href = "/account-settings.html";
    node.textContent = label;
  });
}

function setLogoutVisibility(session) {
  const signedIn = Boolean(session?.cognitoEmail);
  qsa("[data-logout]").forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) {
      return;
    }
    node.hidden = !signedIn;
    node.style.display = signedIn ? "" : "none";
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
  normalizeHeaderShell();
  normalizeFooterShell();

  const session = getSession();
  const db = getDB();

  setRoleText(session);
  setAuthLinks(session);
  setLogoutVisibility(session);
  markActiveLinks();
  mountMaintenanceBanner(db, session);
  bindGlobalButtons();
  bindToastEvent();

  return { session, db };
}
