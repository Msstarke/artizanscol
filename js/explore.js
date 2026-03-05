import { ensureUserForCognito, getDB, hydrateDB, toggleSaveArtist } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { getSession, setSession } from "./session.js";
import { assertCanMutate } from "./router-guards.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, qsa, showToast } from "./utils.js";
import { artistCardHTML } from "./renderers.js";

initSharedPage();
await hydrateDB();

let db = getDB();
let session = getSession();

const searchInput = byId("search-input");
const categoryFilter = byId("category-filter");
const mediumFilter = byId("medium-filter");
const locationFilter = byId("location-filter");
const availabilityFilter = byId("availability-filter");
const priceFilter = byId("price-filter");
const sortSelect = byId("sort-select");
const resetBtn = byId("reset-filters");
const resultsRoot = byId("artist-results");
const resultCount = byId("result-count");
const exploreBookingCta = byId("explore-booking-cta");

function unique(list) {
  return [...new Set(list)].sort((a, b) => String(a).localeCompare(String(b)));
}

function fillSelect(select, values) {
  if (!select) return;
  const existing = Array.from(select.querySelectorAll("option")).map((option) => option.value);
  values.forEach((value) => {
    if (existing.includes(value)) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

fillSelect(categoryFilter, unique(db.categories.filter((category) => category.active).map((category) => category.name)));
fillSelect(mediumFilter, unique(db.artists.flatMap((artist) => artist.mediums || [])));
fillSelect(locationFilter, unique(db.artists.map((artist) => artist.location).filter(Boolean)));

function getFilteredArtists() {
  const search = (searchInput?.value || "").trim().toLowerCase();
  const category = categoryFilter?.value || "";
  const medium = mediumFilter?.value || "";
  const location = locationFilter?.value || "";
  const availability = availabilityFilter?.value || "";
  const maxPrice = Number(priceFilter?.value || 0);
  const sort = sortSelect?.value || "newest";

  let artists = [...db.artists];

  artists = artists.filter((artist) => {
    if (search) {
      const haystack = `${artist.name} ${artist.category} ${(artist.mediums || []).join(" ")}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (category && artist.category !== category) {
      return false;
    }

    if (medium && !(artist.mediums || []).includes(medium)) {
      return false;
    }

    if (location && artist.location !== location) {
      return false;
    }

    if (availability && artist.availability !== availability) {
      return false;
    }

    if (maxPrice > 0 && artist.priceFrom > maxPrice) {
      return false;
    }

    return true;
  });

  if (sort === "newest") {
    artists.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (sort === "popular") {
    artists.sort((a, b) => b.popularity - a.popularity);
  }
  if (sort === "rating") {
    artists.sort((a, b) => b.rating - a.rating);
  }

  return artists;
}

function handleSaveArtist(artistId) {
  if (!isCognitoAuthenticated()) {
    const next = encodeURIComponent(`/artist-preview.html?id=${artistId}`);
    window.location.href = `/account-settings.html?next=${next}`;
    return;
  }

  if (!session.activeUserId) {
    const ensuredUser = ensureUserForCognito({
      sub: session.cognitoSub,
      email: session.cognitoEmail,
      username: session.cognitoUsername,
    });

    if (!ensuredUser) {
      const next = encodeURIComponent(`/artist-preview.html?id=${artistId}`);
      window.location.href = `/account-settings.html?next=${next}`;
      return;
    }

    session = setSession({
      ...session,
      role: "none",
      activeUserId: ensuredUser.id,
    });
  }

  if (!assertCanMutate(session)) {
    return;
  }

  const saved = toggleSaveArtist(session.activeUserId, artistId);
  db = getDB();
  showToast(saved ? "Artist saved" : "Artist removed from saved list", "success");
  render();
}

function updateExploreBookingCta(artists = db.artists) {
  if (!(exploreBookingCta instanceof HTMLAnchorElement)) {
    return;
  }

  if (!isCognitoAuthenticated()) {
    exploreBookingCta.textContent = "Sign in to book";
    exploreBookingCta.href = "/account-settings.html?next=%2Fexplore.html";
    return;
  }

  const firstArtist = artists[0] || db.artists[0] || null;
  exploreBookingCta.textContent = "Book this artist";
  exploreBookingCta.href = firstArtist ? `/artist-preview.html?id=${encodeURIComponent(firstArtist.id)}` : "/artist-preview.html";
}

function render() {
  const artists = getFilteredArtists();
  updateExploreBookingCta(artists);

  if (resultsRoot) {
    if (!artists.length) {
      resultsRoot.innerHTML = db.artists.length
        ? `<div class="empty-state">No artists match this filter set.</div>`
        : `<div class="empty-state">No artist profiles are live yet. Sign in as an artist to create the first listing.</div>`;
    } else {
      resultsRoot.innerHTML = artists
        .map((artist) => {
          const preview = `/artist-preview.html?id=${artist.id}`;
          const actionButtons = `
            <div class="form-actions">
              <a class="btn btn-outline btn-small" href="${preview}">Preview</a>
              <button class="btn btn-ghost btn-small" type="button" data-save-artist="${artist.id}">Save artist</button>
            </div>
          `;
          return artistCardHTML(artist, { actionButtons });
        })
        .join("");
    }
  }

  if (resultCount) {
    resultCount.textContent = `${artists.length} artist${artists.length === 1 ? "" : "s"}`;
  }

  qsa("[data-save-artist]").forEach((button) => {
    button.addEventListener("click", () => {
      handleSaveArtist(button.getAttribute("data-save-artist") || "");
    });
  });
}

[
  searchInput,
  categoryFilter,
  mediumFilter,
  locationFilter,
  availabilityFilter,
  priceFilter,
  sortSelect,
].forEach((input) => {
  input?.addEventListener("input", render);
  input?.addEventListener("change", render);
});

resetBtn?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  if (categoryFilter) categoryFilter.value = "";
  if (mediumFilter) mediumFilter.value = "";
  if (locationFilter) locationFilter.value = "";
  if (availabilityFilter) availabilityFilter.value = "";
  if (priceFilter) priceFilter.value = "";
  if (sortSelect) sortSelect.value = "newest";
  render();
});

render();
