import { getDB, getArtistById, hydrateDB, updateArtistProfile } from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, showToast } from "../utils.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["artist"]);
if (!session) throw new Error("Unauthorized");

const categorySelect = byId("onboard-category");
const mediumInput = byId("onboard-medium");
const priceInput = byId("onboard-price");
const availabilitySelect = byId("onboard-availability");
const portfolioInput = byId("onboard-portfolio");

function render() {
  const db = getDB();
  const artist = getArtistById(db, session.activeArtistId);
  if (!artist) return;

  if (categorySelect) {
    categorySelect.innerHTML = db.categories
      .filter((category) => category.active)
      .map((category) => `<option value="${category.name}">${category.name}</option>`)
      .join("");
    categorySelect.value = artist.category;
  }

  if (mediumInput) mediumInput.value = artist.mediums[0] || "";
  if (priceInput) priceInput.value = String(artist.priceFrom || 0);
  if (availabilitySelect) availabilitySelect.value = artist.availability;
  if (portfolioInput) portfolioInput.value = artist.portfolio[0]?.image || "";
}

byId("onboarding-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  const db = getDB();
  const currentArtist = getArtistById(db, session.activeArtistId);
  const portfolioUrl = (portfolioInput?.value || "").trim();

  updateArtistProfile(session.activeArtistId, {
    category: categorySelect?.value || "Illustration",
    mediums: [mediumInput?.value || "Digital"],
    priceFrom: Number(priceInput?.value || 100),
    availability: availabilitySelect?.value || "open",
    portfolio: portfolioUrl
      ? [
          {
            id: `p-${Date.now()}`,
            title: "Portfolio Sample",
            image: portfolioUrl,
          },
        ]
      : currentArtist?.portfolio || [],
  });
  showToast("Onboarding details saved", "success");
  render();
});

render();
