import { ensureUserForCognito, getDB, getVisibleArtists, hydrateDB, toggleSaveArtist } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { getSession, setSession } from "./session.js";
import { assertCanMutate } from "./router-guards.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, escapeHtml, formatMoney, getQueryParam, qsa, showToast } from "./utils.js";
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
const discoveryInsights = byId("discovery-insights");
const toggleFiltersBtn = byId("toggle-filters");
const toggleFiltersLabel = byId("toggle-filters-label");
const filterCountBadge = byId("filter-count-badge");
const exploreSidebar = byId("explore-sidebar");

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

function countBy(list, selector) {
  return list.reduce((accumulator, item) => {
    const key = selector(item);
    if (!key) return accumulator;
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function getLiveArtists() {
  return getVisibleArtists(db);
}

function getSuggestedCategories(limit = 4) {
  const liveArtists = getLiveArtists();
  const liveCounts = Object.entries(countBy(liveArtists, (artist) => artist.category))
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([name, count]) => ({
      label: name,
      count,
      href: `/explore.html?category=${encodeURIComponent(name)}`,
    }));

  if (liveCounts.length) {
    return liveCounts;
  }

  return db.categories
    .filter((category) => category.active)
    .slice(0, limit)
    .map((category) => ({
      label: category.name,
      count: null,
      href: `/explore.html?category=${encodeURIComponent(category.name)}`,
    }));
}

function getSuggestedMediums(limit = 4) {
  return Object.entries(countBy(getLiveArtists().flatMap((artist) => artist.mediums || []), (medium) => medium))
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([name]) => ({
      label: name,
      href: `/explore.html?medium=${encodeURIComponent(name)}`,
    }));
}

function renderDiscoveryInsights(filteredArtists) {
  if (!discoveryInsights) {
    return;
  }

  const liveArtists = getLiveArtists();
  const displayArtists = filteredArtists ?? liveArtists;
  const activeCategories = db.categories.filter((category) => category.active).length;
  const verifiedCount = displayArtists.filter((artist) => artist.verified).length;
  const openCount = displayArtists.filter((artist) => artist.availability === "open").length;
  const startingBudgets = displayArtists.map((artist) => Number(artist.priceFrom || 0)).filter((value) => value > 0);
  const lowestBudget = startingBudgets.length ? Math.min(...startingBudgets) : null;

  const items = liveArtists.length
    ? [
        { value: displayArtists.length, label: displayArtists.length === liveArtists.length ? "live profiles" : "matching profiles" },
        { value: verifiedCount || "—", label: "reviewed profiles" },
        { value: openCount, label: "open for briefs" },
        { value: lowestBudget ? `From ${formatMoney(lowestBudget)}` : "Flexible", label: "starting budgets" },
      ]
    : [
        { value: activeCategories || "—", label: "ready categories" },
        { value: "Coming", label: "creator studios" },
        { value: "Open", label: "for registrations" },
      ];

  discoveryInsights.innerHTML = items
    .map(
      (item) => `
        <article class="site-card discovery-insight-card">
          <strong>${escapeHtml(String(item.value))}</strong>
          <span>${escapeHtml(item.label)}</span>
        </article>
      `,
    )
    .join("");
}

fillSelect(categoryFilter, unique(db.categories.filter((category) => category.active).map((category) => category.name)));
fillSelect(mediumFilter, unique(getVisibleArtists(db).flatMap((artist) => artist.mediums || [])));
fillSelect(locationFilter, unique(getVisibleArtists(db).map((artist) => artist.location).filter(Boolean)));

// Category chips bar
const categoryChipsEl = byId("category-chips");
function renderCategoryChips() {
  if (!categoryChipsEl) return;
  const categories = unique(
    db.categories.filter((c) => c.active).map((c) => c.name)
      .concat(getVisibleArtists(db).map((a) => a.category).filter(Boolean))
  );
  const activeCategory = categoryFilter?.value || "";
  categoryChipsEl.innerHTML =
    `<button class="category-chip${!activeCategory ? " is-active" : ""}" data-chip-value="" type="button">All</button>` +
    categories
      .map((cat) => `<button class="category-chip${activeCategory === cat ? " is-active" : ""}" data-chip-value="${escapeHtml(cat)}" type="button">${escapeHtml(cat)}</button>`)
      .join("");
}
renderCategoryChips();

categoryChipsEl?.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-chip-value]");
  if (!chip) return;
  const value = chip.getAttribute("data-chip-value");
  if (categoryFilter) categoryFilter.value = value;
  renderCategoryChips();
  render();
});

// Hide filter selects that have no real options (single-value filters add friction)
[categoryFilter, mediumFilter, locationFilter].forEach((select) => {
  if (!select) return;
  const hasOptions = select.querySelectorAll("option:not([value=''])").length > 0;
  const wrapper = select.closest("label");
  if (wrapper) wrapper.hidden = !hasOptions;
});

// Filter sidebar toggle (mobile/tablet)
function setSidebarOpen(open) {
  exploreSidebar?.classList.toggle("is-open", open);
  toggleFiltersBtn?.setAttribute("aria-expanded", String(open));
  if (toggleFiltersLabel) toggleFiltersLabel.textContent = open ? "Hide filters" : "Filters";
}

toggleFiltersBtn?.addEventListener("click", () => {
  setSidebarOpen(!exploreSidebar?.classList.contains("is-open"));
});

// Close sidebar if viewport grows past the mobile breakpoint
window.addEventListener("resize", () => {
  if (window.innerWidth > 1100 && exploreSidebar?.classList.contains("is-open")) {
    setSidebarOpen(false);
  }
}, { passive: true });

function seedFiltersFromQuery() {
  if (searchInput) {
    searchInput.value = getQueryParam("q") || getQueryParam("search") || "";
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

    if (medium && !(artist.mediums || []).some((m) => m.toLowerCase() === medium.toLowerCase())) {
      return false;
    }

    if (location) {
      const loc = location.toLowerCase();
      const parts = String(artist.location || "").split(",").map((p) => p.trim().toLowerCase());
      const match = parts.some((part) => part === loc || part.startsWith(loc));
      if (!match) return false;
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
  if (sort === "most_popular") {
    artists.sort((a, b) => b.popularity - a.popularity);
  }
  if (sort === "highest_rated") {
    artists.sort((a, b) => b.rating - a.rating);
  }

  return artists;
}

function syncQueryState() {
  const params = new URLSearchParams();
  const search = (searchInput?.value || "").trim();
  if (search) params.set("q", search);
  if (categoryFilter?.value) params.set("category", categoryFilter.value);
  if (mediumFilter?.value) params.set("medium", mediumFilter.value);
  if (locationFilter?.value) params.set("location", locationFilter.value);
  if (availabilityFilter?.value) params.set("availability", availabilityFilter.value);
  if (priceFilter?.value) params.set("maxPrice", priceFilter.value);
  if ((sortSelect?.value || "newest") !== "newest") params.set("sort", sortSelect.value);

  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState({}, "", next);
  }
}

function getActiveFilterLabels() {
  const labels = [];
  const search = (searchInput?.value || "").trim();
  if (search) labels.push(`Search: ${search}`);
  if (categoryFilter?.value) labels.push(`Category: ${categoryFilter.value}`);
  if (mediumFilter?.value) labels.push(`Medium: ${mediumFilter.value}`);
  if (locationFilter?.value) labels.push(`Location: ${locationFilter.value}`);
  if (availabilityFilter?.value) {
    const availLabel = availabilityFilter.value === "limited" ? "Limited" : availabilityFilter.value === "open" ? "Open" : availabilityFilter.value;
    labels.push(`Availability: ${availLabel}`);
  }
  if (priceFilter?.value) labels.push(`Max price: $${Number(priceFilter.value).toLocaleString()}`);
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
  exploreBookingCta.textContent = firstArtist ? "View featured profile" : "Preview profile layout";
  exploreBookingCta.href = firstArtist ? `/artist-preview.html?id=${encodeURIComponent(firstArtist.id)}` : "/artist-preview.html";
}

function renderSuggestedLinks(items, className = "empty-state-links") {
  if (!items.length) {
    return "";
  }

  return `
    <div class="${className}">
      ${items
        .map(
          (item) => `
            <a class="filter-chip filter-chip-link" href="${escapeHtml(item.href)}">
              ${escapeHtml(item.label)}${item.count ? ` <span>${escapeHtml(String(item.count))}</span>` : ""}
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderEmptyState() {
  const liveArtists = getLiveArtists();
  if (!liveArtists.length) {
    return `
      <article class="empty-state empty-state-rich">
        <p class="site-tag">Discovery is ready</p>
        <h3>No creator studios are live yet.</h3>
        <p>The platform is open. Creator studios will appear here once creators complete their setup and go live. Check back soon or browse the categories below.</p>
        <div class="form-actions">
          <a class="btn btn-outline btn-small" href="/about.html">About the platform</a>
          <a class="btn btn-ghost btn-small" href="/artist-preview.html">Preview profile layout</a>
        </div>
        ${renderSuggestedLinks(getSuggestedCategories(4))}
      </article>
    `;
  }

  return `
    <article class="empty-state empty-state-rich">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.35;margin-bottom:0.25rem;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      <p class="site-tag">No matches</p>
      <h3>No artists match these filters.</h3>
      <p>${escapeHtml(String(liveArtists.length))} artist${liveArtists.length === 1 ? "" : "s"} live on the platform — try broadening your search.</p>
      <div class="form-actions">
        <button class="btn btn-primary btn-small" type="button" data-clear-empty-state>Clear all filters</button>
        <a class="btn btn-ghost btn-small" href="/explore.html">Browse all</a>
      </div>
      ${renderSuggestedLinks(getSuggestedCategories(4))}
      ${renderSuggestedLinks(getSuggestedMediums(4), "empty-state-links empty-state-links-secondary")}
    </article>
  `;
}

function render() {
  const artists = getFilteredArtists();
  const activeLabels = getActiveFilterLabels();
  const liveArtists = getLiveArtists();

  updateSortOptionAvailability();
  renderDiscoveryInsights(artists);
  renderCategoryChips();
  syncQueryState();
  updateExploreBookingCta(artists);

  if (filterCountBadge) {
    const count = activeLabels.length;
    filterCountBadge.textContent = String(count);
    filterCountBadge.hidden = count === 0;
  }

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
      resultsRoot.innerHTML = renderEmptyState();
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

  const clearEmptyStateBtn = resultsRoot?.querySelector("[data-clear-empty-state]");
  clearEmptyStateBtn?.addEventListener("click", () => {
    resetBtn?.click();
  });

  if (resultCount) {
    if (!liveArtists.length) {
      resultCount.textContent = "No live profiles";
    } else if (!artists.length) {
      resultCount.textContent = "0 matches";
    } else {
      resultCount.textContent = `${artists.length} live profile${artists.length === 1 ? "" : "s"}`;
    }
  }

  if (resultSummary) {
    if (!liveArtists.length) {
      resultSummary.textContent = "Categories are ready. Discovery fills in as artists publish live profiles.";
    } else if (!artists.length) {
      resultSummary.textContent = "Reset filters or start from one of the live categories below.";
    } else if (artists.length <= 2) {
      resultSummary.textContent = "A narrow shortlist. Open each profile and compare fit before sending a brief.";
    } else {
      const verifiedCount = artists.filter((artist) => artist.verified).length;
      const openCount = artists.filter((artist) => artist.availability === "open").length;
      resultSummary.textContent = `${verifiedCount} reviewed profile${verifiedCount === 1 ? "" : "s"} and ${openCount} open for briefs in this view.`;
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

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedRender = debounce(render, 300);

searchInput?.addEventListener("input", debouncedRender);
searchInput?.addEventListener("change", debouncedRender);

[
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

function updateSortOptionAvailability() {
  if (!sortSelect) return;
  const artists = getVisibleArtists(getDB());
  const hasPopularity = artists.some((a) => a.popularity);
  const hasRatings = artists.some((a) => a.rating);
  for (const option of sortSelect.options) {
    if (option.value === "most_popular") {
      option.disabled = !hasPopularity;
      option.textContent = hasPopularity ? "Most popular" : "Most popular (no data yet)";
    } else if (option.value === "highest_rated") {
      option.disabled = !hasRatings;
      option.textContent = hasRatings ? "Highest rated" : "Highest rated (no ratings yet)";
    }
  }
  // If current selection is now disabled, reset to newest
  if (sortSelect.selectedOptions[0]?.disabled) {
    sortSelect.value = "newest";
  }
}

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
