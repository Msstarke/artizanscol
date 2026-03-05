import { getDB, hydrateDB } from "./store.js";
import { getSession } from "./session.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, showToast } from "./utils.js";
import { artistCardHTML } from "./renderers.js";

initSharedPage();
await hydrateDB();

const db = getDB();
const session = getSession();

const upcoming = [...db.artists]
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, 6);

const upcomingRoot = byId("upcoming-artists");
if (upcomingRoot) {
  upcomingRoot.innerHTML = upcoming.length
    ? upcoming
        .map((artist) => {
          const href = `/artist-preview.html?id=${artist.id}`;
          return artistCardHTML(artist, {
            actionButtons: `<div class="form-actions"><a class="btn btn-outline btn-small" href="${href}">Preview</a></div>`,
          });
        })
        .join("")
    : `<div class="empty-state">No artists have created a profile yet. Sign in as an artist to publish your profile.</div>`;
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
      .map(([name, count]) => `<span class="tag">${name} (${count})</span>`)
      .join("");
  } else {
    topCategoriesRoot.innerHTML = db.categories
      .filter((category) => category.active)
      .slice(0, 6)
      .map((category) => `<span class="tag">${category.name}</span>`)
      .join("");
  }
}

if (db.system.maintenanceMode) {
  showToast("Maintenance mode is active. Browse-only mode enabled.", "warning");
}
