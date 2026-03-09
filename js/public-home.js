import { getDB, hydrateDB } from "./store.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, escapeHtml, formatMoney, showToast } from "./utils.js";
import { artistCardHTML } from "./renderers.js";

initSharedPage();
await hydrateDB();

const db = getDB();
const heroProofRow = byId("hero-proof-row");
const heroSpotlight = byId("hero-spotlight");

const upcoming = [...db.artists]
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, 6);

const upcomingRoot = byId("upcoming-artists");
if (upcomingRoot) {
  upcomingRoot.classList.toggle("has-empty-state", !upcoming.length);
  upcomingRoot.innerHTML = upcoming.length
    ? upcoming
        .map((artist) => {
          const href = `/artist-preview.html?id=${encodeURIComponent(String(artist.id || ""))}`;
          return artistCardHTML(artist, {
            actionButtons: `<div class="form-actions"><a class="btn btn-outline btn-small" href="${href}">Preview</a></div>`,
          });
        })
        .join("")
    : `
        <article class="site-card spotlight-card">
          <p class="site-tag">Profiles opening soon</p>
          <h3>Artist listings are not live yet.</h3>
          <p>Use the preview flow to review the public experience while the first profiles are being published.</p>
          <div class="form-actions">
            <a class="btn btn-outline btn-small" href="/artist-preview.html">Preview the profile flow</a>
            <a class="btn btn-ghost btn-small" href="/account-settings.html">Open account access</a>
          </div>
        </article>
      `;
}

const topCategoriesRoot = byId("top-categories");
if (topCategoriesRoot) {
  const categoryCounts = db.artists.reduce((acc, artist) => {
    acc[artist.category] = (acc[artist.category] || 0) + 1;
    return acc;
  }, {});

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (topCategories.length) {
    topCategoriesRoot.innerHTML = topCategories
      .map(
        ([name, count]) => `
          <a class="category-link-card" href="/explore.html?category=${encodeURIComponent(name)}">
            <p class="site-tag">Active category</p>
            <h3>${escapeHtml(name)}</h3>
            <div class="category-link-meta">
              <span>${count} artist${count === 1 ? "" : "s"}</span>
              <span>Browse now</span>
            </div>
          </a>
        `,
      )
      .join("");
  } else {
    topCategoriesRoot.innerHTML = db.categories
      .filter((category) => category.active)
      .slice(0, 6)
      .map(
        (category) => `
          <a class="category-link-card" href="/explore.html?category=${encodeURIComponent(category.name)}">
            <p class="site-tag">Active category</p>
            <h3>${escapeHtml(category.name)}</h3>
            <div class="category-link-meta">
              <span>Open shortlist</span>
              <span>Browse now</span>
            </div>
          </a>
        `,
      )
      .join("");
  }
}

if (heroProofRow) {
  const verifiedCount = db.artists.filter((artist) => artist.verified).length;
  const servicesCount = db.services.length;
  const activeCategories = db.categories.filter((category) => category.active).length;

  heroProofRow.innerHTML = [
    { value: verifiedCount || db.artists.length, label: "artist profiles ready to review" },
    { value: servicesCount || db.artists.length, label: "visible service offers" },
    { value: activeCategories, label: "creative categories to browse" },
  ]
    .map(
      (item) => `
        <article class="site-card hero-proof-card">
          <strong>${escapeHtml(String(item.value))}</strong>
          <span>${escapeHtml(item.label)}</span>
        </article>
      `,
    )
    .join("");
}

if (heroSpotlight) {
  const spotlightArtist = upcoming[0] || db.artists[0] || null;
  if (spotlightArtist) {
    heroSpotlight.innerHTML = `
      <article class="spotlight-card">
        <p class="site-tag">Featured profile</p>
        <h3>${escapeHtml(spotlightArtist.name)}</h3>
        <p>${escapeHtml(spotlightArtist.category)} • ${escapeHtml(spotlightArtist.location || "Location pending")}</p>
        <p class="muted">From ${escapeHtml(formatMoney(spotlightArtist.priceFrom || 0))} • ${escapeHtml(
          spotlightArtist.verified ? "Verified presentation" : "Profile under review",
        )}</p>
        <a class="btn btn-outline btn-small" href="/artist-preview.html?id=${encodeURIComponent(String(spotlightArtist.id || ""))}">Open profile</a>
      </article>
    `;
  } else {
    heroSpotlight.innerHTML = `
      <article class="spotlight-card">
        <p class="site-tag">Preview the flow</p>
        <h3>The public hiring journey is ready before the first listings go live.</h3>
        <p>Browse the category entry points, then use the artist preview page to review how clients will assess a profile and send a brief.</p>
        <a class="btn btn-outline btn-small" href="/artist-preview.html">Open preview flow</a>
      </article>
    `;
  }
}

if (db.system.maintenanceMode) {
  showToast("Maintenance mode is active. Browse-only mode enabled.", "warning");
}
