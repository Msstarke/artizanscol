import { getDB, getVisibleArtists, hydrateDB } from "./store.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, escapeHtml, formatMoney, showToast } from "./utils.js";
import { artistCardHTML } from "./renderers.js";

initSharedPage();
await hydrateDB();

const db = getDB();
const visibleArtists = getVisibleArtists(db);
const heroProofRow = byId("hero-proof-row");
const heroSpotlight = byId("hero-spotlight");
const profileStoryGrid = byId("profile-story-grid");

const upcoming = [...visibleArtists]
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
            previewHref: href,
            actionButtons: `<div class="form-actions"><a class="btn btn-outline btn-small" href="${href}">View profile</a></div>`,
          });
        })
        .join("")
    : `
        <article class="site-card spotlight-card">
          <p class="site-tag">Profiles opening soon</p>
          <h3>Profiles are coming soon.</h3>
          <p>Use the preview flow while the first live accounts are being published.</p>
          <div class="form-actions">
            <a class="btn btn-outline btn-small" href="/artist-preview.html">Preview the profile flow</a>
            <a class="btn btn-ghost btn-small" href="/account-settings.html">Open account access</a>
          </div>
        </article>
      `;
}

const topCategoriesRoot = byId("top-categories");
if (topCategoriesRoot) {
  const categoryCounts = visibleArtists.reduce((acc, artist) => {
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
  const verifiedCount = visibleArtists.filter((artist) => artist.verified).length;
  const visibleProfileCount = visibleArtists.length;
  const activeCategories = db.categories.filter((category) => category.active).length;

  heroProofRow.innerHTML = [
    { value: verifiedCount || visibleArtists.length, label: "published profiles" },
    { value: visibleProfileCount || db.artists.length, label: "live artist accounts" },
    { value: activeCategories, label: "browseable categories" },
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
  const spotlightArtist = upcoming[0] || visibleArtists[0] || null;
  if (spotlightArtist) {
    const spotlightImage = escapeHtml(String(spotlightArtist.portfolio?.[0]?.image || spotlightArtist.portfolio?.[0]?.imageUrl || ""));
    heroSpotlight.innerHTML = `
      <article class="spotlight-card">
        <p class="site-tag">Featured profile</p>
        ${spotlightImage ? `<div class="spotlight-card-media"><img src="${spotlightImage}" alt="${escapeHtml(spotlightArtist.name)} work preview" /></div>` : ""}
        <h3>${escapeHtml(spotlightArtist.name)}</h3>
        <p>${escapeHtml(spotlightArtist.category || "Creative profile")} • ${escapeHtml(spotlightArtist.location || "Remote or flexible")}</p>
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
        <h3>The hiring flow is ready.</h3>
        <p>Browse categories, then open the profile preview to see the client journey.</p>
        <a class="btn btn-outline btn-small" href="/artist-preview.html">Open preview flow</a>
      </article>
    `;
  }
}

if (profileStoryGrid) {
  const spotlightProfiles = visibleArtists.slice(0, 3);
  profileStoryGrid.innerHTML = spotlightProfiles.length
    ? spotlightProfiles
        .map(
          (artist) => `
            <article class="site-card profile-story-card">
              <p class="site-tag">${escapeHtml(artist.category || "Creative profile")}</p>
              <h3>${escapeHtml(artist.name)}</h3>
              <p>${escapeHtml(artist.bio || "Published profile with clear mediums, pricing signals, and client-ready availability.")}</p>
              <div class="meta-row">
                <span>${escapeHtml((artist.mediums || []).slice(0, 2).join(" • ") || "Creative practice")}</span>
                <span>${escapeHtml(artist.location || "Remote or flexible")}</span>
              </div>
              <a class="btn btn-outline btn-small" href="/artist-preview.html?id=${encodeURIComponent(String(artist.id || ""))}">See profile</a>
            </article>
          `,
        )
        .join("")
    : `
        <article class="site-card profile-story-card">
          <p class="site-tag">Published profiles</p>
          <h3>Live profiles will appear here.</h3>
          <p>Once an artist turns on their public profile, it will show up across the homepage, Explore, and the profile preview flow.</p>
          <a class="btn btn-outline btn-small" href="/account-settings.html">Open account settings</a>
        </article>
      `;
}

if (db.system.maintenanceMode) {
  showToast("Maintenance mode is active. Browse-only mode enabled.", "warning");
}
