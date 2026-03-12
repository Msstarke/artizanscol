import { ensureUserForCognito, getDB, getVisibleArtists, hydrateDB, toggleSaveArtist } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { getSession, setSession } from "./session.js";
import { assertCanMutate } from "./router-guards.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, getQueryParam, qsa, showToast } from "./utils.js";
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
const resultSummary = byId("result-summary");
const exploreBookingCta = byId("explore-booking-cta");
const activeFilterSummary = byId("active-filter-summary");

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
fillSelect(mediumFilter, unique(getVisibleArtists(db).flatMap((artist) => artist.mediums || [])));
fillSelect(locationFilter, unique(getVisibleArtists(db).map((artist) => artist.location).filter(Boolean)));

function seedFiltersFromQuery() {
  if (searchInput) {
    searchInput.value = getQueryParam("search") || "";
  }
  if (categoryFilter) {
    categoryFilter.value = getQueryParam("category") || "";
  }
  if (mediumFilter) {
    mediumFilter.value = getQueryParam("medium") || "";
  }
  if (locationFilter) {
    locationFilter.value = getQueryParam("location") || "";
  }
  if (availabilityFilter) {
    availabilityFilter.value = getQueryParam("availability") || "";
  }
  if (priceFilter) {
    priceFilter.value = getQueryParam("maxPrice") || "";
  }
  if (sortSelect) {
    sortSelect.value = getQueryParam("sort") || "newest";
  }
}

seedFiltersFromQuery();

function getFilteredArtists() {
  const search = (searchInput?.value || "").trim().toLowerCase();
  const category = categoryFilter?.value || "";
  const medium = mediumFilter?.value || "";
  const location = locationFilter?.value || "";
  const availability = availabilityFilter?.value || "";
  const maxPrice = Number(priceFilter?.value || 0);
  const sort = sortSelect?.value || "newest";

  let artists = [...getVisibleArtists(db)];

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

function getActiveFilterLabels() {
  const labels = [];
  const search = (searchInput?.value || "").trim();
  if (search) labels.push(`Search: ${search}`);
  if (categoryFilter?.value) labels.push(`Category: ${categoryFilter.value}`);
  if (mediumFilter?.value) labels.push(`Medium: ${mediumFilter.value}`);
  if (locationFilter?.value) labels.push(`Location: ${locationFilter.value}`);
  if (availabilityFilter?.value) labels.push(`Availability: ${availabilityFilter.value}`);
  if (priceFilter?.value) labels.push(`Max price: ${priceFilter.value}`);
  if ((sortSelect?.value || "newest") !== "newest") {
    const label = sortSelect?.selectedOptions?.[0]?.textContent || sortSelect?.value;
    labels.push(`Sort: ${label}`);
  }
  return labels;
}

async function handleSaveArtist(artistId) {
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

  try {
    const saved = await toggleSaveArtist(session.activeUserId, artistId);
    db = getDB();
    showToast(saved ? "Artist saved" : "Artist removed from saved list", "success");
    render();
  } catch (error) {
    showToast(error?.message || "Could not update saved artists.", "danger");
  }
}

function updateExploreBookingCta(artists = db.artists) {
  if (!(exploreBookingCta instanceof HTMLAnchorElement)) {
    return;
  }

  const liveArtists = artists.length ? artists : getVisibleArtists(db);
  const firstArtist = liveArtists[0] || null;
  exploreBookingCta.textContent = firstArtist ? "View featured profile" : "Preview hiring flow";
  exploreBookingCta.href = firstArtist ? `/artist-preview.html?id=${encodeURIComponent(firstArtist.id)}` : "/artist-preview.html";
}

function render() {
  const artists = getFilteredArtists();
  const activeLabels = getActiveFilterLabels();
  updateExploreBookingCta(artists);

  if (activeFilterSummary) {
    activeFilterSummary.replaceChildren();
    if (!activeLabels.length) {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      chip.textContent = "No active filters";
      activeFilterSummary.append(chip);
    } else {
      activeLabels.forEach((label) => {
        const chip = document.createElement("span");
        chip.className = "filter-chip";
        chip.textContent = label;
        activeFilterSummary.append(chip);
      });
    }
  }

  if (resultsRoot) {
    resultsRoot.classList.toggle("has-empty-state", !artists.length);
    if (!artists.length) {
      resultsRoot.innerHTML = getVisibleArtists(db).length
        ? `<div class="empty-state">No artists match this filter set. Reset filters or widen the brief to see more profiles.</div>`
        : `<div class="empty-state">No artist profiles are live yet. Published profiles will appear here once artists start listing their work.</div>`;
    } else {
      resultsRoot.innerHTML = artists
        .map((artist) => {
          const encodedArtistId = encodeURIComponent(String(artist.id || ""));
          const preview = `/artist-preview.html?id=${encodedArtistId}`;
          const actionButtons = `
            <div class="form-actions">
              <a class="btn btn-outline btn-small" href="${preview}">View profile</a>
              <button class="btn btn-ghost btn-small" type="button" data-save-artist="${encodedArtistId}">Save artist</button>
            </div>
          `;
          return artistCardHTML(artist, { actionButtons, previewHref: preview });
        })
        .join("");
    }
  }

  if (resultCount) {
    resultCount.textContent = `${artists.length} artist${artists.length === 1 ? "" : "s"}`;
  }

  if (resultSummary) {
    if (!artists.length) {
      resultSummary.textContent = "Try widening category, medium, or price filters.";
    } else if (artists.length <= 2) {
      resultSummary.textContent = "A narrow shortlist. Open profiles to compare fit before sending a brief.";
    } else {
      const verifiedCount = artists.filter((artist) => artist.verified).length;
      const pricedCount = artists.filter((artist) => Number(artist.priceFrom || 0) > 0).length;
      resultSummary.textContent = `${verifiedCount} verified profile${verifiedCount === 1 ? "" : "s"} and ${pricedCount} with visible starting budgets.`;
    }
  }

  qsa("[data-save-artist]").forEach((button) => {
    button.addEventListener("click", async () => {
      const encodedId = button.getAttribute("data-save-artist") || "";
      let artistId = encodedId;
      try {
        artistId = decodeURIComponent(encodedId);
      } catch (_) {
        artistId = encodedId;
      }
      await handleSaveArtist(artistId);
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
