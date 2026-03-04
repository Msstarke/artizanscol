import { getDB, getUserById, toggleSaveArtist } from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, showToast } from "../utils.js";
import { artistCardHTML } from "../renderers.js";

initSharedPage();
const session = requireRole(["user"]);
if (!session) throw new Error("Unauthorized");

const searchInput = byId("discovery-search");
const savedRoot = byId("saved-artists");
const recommendationRoot = byId("recommended-artists");

function render() {
  const db = getDB();
  const user = getUserById(db, session.activeUserId);
  if (!user) return;

  const search = (searchInput?.value || "").trim().toLowerCase();

  const saved = db.artists.filter((artist) => user.savedArtists.includes(artist.id));
  const recommendations = db.artists
    .filter((artist) => !user.savedArtists.includes(artist.id))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6);

  const filterBySearch = (artist) => {
    if (!search) return true;
    return `${artist.name} ${artist.category}`.toLowerCase().includes(search);
  };

  const savedFiltered = saved.filter(filterBySearch);
  const recFiltered = recommendations.filter(filterBySearch);

  savedRoot.innerHTML = savedFiltered.length
    ? savedFiltered
        .map((artist) => {
          const actions = `<div class="form-actions"><a class="btn btn-outline btn-small" href="/artist-preview.html?id=${artist.id}">Preview</a><button class="btn btn-ghost btn-small" data-save-id="${artist.id}" type="button">Unsave</button></div>`;
          return artistCardHTML(artist, { actionButtons: actions });
        })
        .join("")
    : `<div class="empty-state">No saved artists yet.</div>`;

  recommendationRoot.innerHTML = recFiltered.length
    ? recFiltered
        .map((artist) => {
          const actions = `<div class="form-actions"><a class="btn btn-outline btn-small" href="/artist-preview.html?id=${artist.id}">Preview</a><button class="btn btn-ghost btn-small" data-save-id="${artist.id}" type="button">Save</button></div>`;
          return artistCardHTML(artist, { actionButtons: actions });
        })
        .join("")
    : `<div class="empty-state">No recommendations match your search.</div>`;

  document.querySelectorAll("[data-save-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!assertCanMutate(session)) return;
      const artistId = button.getAttribute("data-save-id") || "";
      const savedNow = toggleSaveArtist(session.activeUserId, artistId);
      showToast(savedNow ? "Artist saved" : "Artist removed", "success");
      render();
    });
  });
}

searchInput?.addEventListener("input", render);
byId("clear-search")?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  render();
});

render();
