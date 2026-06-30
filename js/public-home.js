import { getDB, getVisibleArtists, hydrateDB, getArtistById } from "./store.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, escapeHtml, formatMoney, sanitizeImageUrl } from "./utils.js";
import { artistCardHTML } from "./renderers.js";
import { getSession } from "./session.js";

initSharedPage();
await hydrateDB();

const db = getDB();
const visibleArtists = getVisibleArtists(db);

// Featured artists grid
const upcomingRoot = byId("upcoming-artists");
if (upcomingRoot) {
  const artists = [...visibleArtists]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  upcomingRoot.classList.toggle("has-empty-state", !artists.length);
  upcomingRoot.innerHTML = artists.length
    ? artists
        .map((artist) => {
          const href = `/artist-preview.html?id=${encodeURIComponent(String(artist.id || ""))}`;
          return artistCardHTML(artist, {
            previewHref: href,
            actionButtons: `<div class="form-actions"><a class="btn btn-outline btn-small" href="${href}">View profile</a></div>`,
          });
        })
        .join("")
    : `
        <article class="empty-state empty-state-rich">
          <p class="site-tag">profiles rolling out</p>
          <h3>no live profiles yet.</h3>
          <p>artist profiles show up here as creators finish setup and publish. have a browse through the categories in the meantime.</p>
          <div class="form-actions">
            <a class="btn btn-outline btn-small" href="/explore.html">Open Explore</a>
            <a class="btn btn-ghost btn-small" href="/artist-preview.html">Preview a profile</a>
          </div>
        </article>
      `;
}

// Hero stats row
const heroStats = byId("hero-proof-row");
if (heroStats) {
  const verifiedCount = visibleArtists.filter((a) => a.verified).length;
  const activeCategories = db.categories.filter((c) => c.active).length;
  const budgets = visibleArtists.map((a) => Number(a.priceFrom || 0)).filter((v) => v > 0);
  const lowestBudget = budgets.length ? Math.min(...budgets) : null;

  const stats = visibleArtists.length
    ? [
        { value: visibleArtists.length, label: `live profile${visibleArtists.length === 1 ? "" : "s"}` },
        { value: verifiedCount || "—", label: "reviewed" },
        { value: lowestBudget ? `From ${formatMoney(lowestBudget)}` : "Flexible", label: "starting budgets" },
      ]
    : [
        { value: activeCategories || "—", label: "categories ready" },
        { value: "Human", label: "verified creators only" },
        { value: "Open", label: "for registrations" },
      ];

  heroStats.innerHTML = stats
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

// Artist marquee
const marqueeSection = byId("artist-marquee");
const marqueeTrack = byId("marquee-track");
if (marqueeSection && marqueeTrack && visibleArtists.length >= 3) {
  const items = [...visibleArtists]
    .sort(() => Math.random() - 0.5)
    .slice(0, 12);

  const FALLBACK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect width='36' height='36' fill='%23dac3a8' rx='18'/%3E%3C/svg%3E";

  const itemHTML = items
    .map((a) => {
      const href = `/artist-preview.html?id=${encodeURIComponent(String(a.id || ""))}`;
      const portfolio = Array.isArray(a.portfolio) ? a.portfolio : [];
      const imgSrc = sanitizeImageUrl(portfolio[0]?.imageUrl || portfolio[0]?.image, FALLBACK_IMG);
      return `<a class="marquee-item" href="${escapeHtml(href)}">
        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(a.name || "Artist")}" width="36" height="36" loading="lazy" />
        <div class="marquee-item-info">
          <strong>${escapeHtml(a.name || "Artist")}</strong>
          <span>${escapeHtml(a.category || "Creative")}</span>
        </div>
      </a>`;
    })
    .join("");

  marqueeTrack.innerHTML = itemHTML + itemHTML;
  // Section starts visible with reserved height; it fills in place (no shift).
} else if (marqueeSection) {
  // Not enough artists to feature — collapse the reserved space.
  marqueeSection.hidden = true;
}

// Adapt artist CTAs based on session state
const session = getSession();
const signedIn = Boolean(session?.cognitoEmail);

if (signedIn) {
  const artist = getArtistById(db, session.activeArtistId);

  let label = "Go to workspace";
  if (artist && !artist.category) label = "Finish your profile";
  else if (artist && artist.category && !artist.profileVisible) label = "Publish your profile";

  document.querySelectorAll("[data-artist-cta]").forEach((el) => {
    if (!(el instanceof HTMLAnchorElement)) return;
    el.textContent = label;
    el.href = "/account-settings.html";
  });
}
// signed out: leave default text/href unchanged
