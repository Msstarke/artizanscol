import {
  getArtistById,
  getDB,
  getServicesForArtist,
  removeService,
  updateArtistProfile,
  upsertService,
} from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, formatMoney, showToast } from "../utils.js";

initSharedPage();
const session = requireRole(["artist"]);
if (!session) throw new Error("Unauthorized");

const nameInput = byId("artist-name");
const locationInput = byId("artist-location");
const bioInput = byId("artist-bio");
const serviceList = byId("service-list");

function render() {
  const db = getDB();
  const artist = getArtistById(db, session.activeArtistId);
  if (!artist) return;

  if (nameInput) nameInput.value = artist.name;
  if (locationInput) locationInput.value = artist.location;
  if (bioInput) bioInput.value = artist.bio;

  const services = getServicesForArtist(db, artist.id);
  serviceList.innerHTML = services.length
    ? services
        .map(
          (service) => `
        <li class="collection-item">
          <h4>${service.title}</h4>
          <p>${service.description}</p>
          <p><strong>${formatMoney(service.price)}</strong> • ${service.deliveryDays} days</p>
          <div class="form-actions"><button class="btn btn-danger btn-small" type="button" data-remove-service="${service.id}">Remove</button></div>
        </li>
      `,
        )
        .join("")
    : `<li class="empty-state">No services added yet.</li>`;

  document.querySelectorAll("[data-remove-service]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!assertCanMutate(session)) return;
      const serviceId = button.getAttribute("data-remove-service") || "";
      removeService(session.activeArtistId, serviceId);
      showToast("Service removed", "success");
      render();
    });
  });
}

byId("artist-profile-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  updateArtistProfile(session.activeArtistId, {
    name: nameInput?.value || "",
    location: locationInput?.value || "",
    bio: bioInput?.value || "",
  });
  showToast("Artist profile updated", "success");
  render();
});

byId("service-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  const title = byId("service-title")?.value.trim();
  const description = byId("service-description")?.value.trim();
  const price = Number(byId("service-price")?.value || 0);
  const deliveryDays = Number(byId("service-days")?.value || 0);

  if (!title || !description || !price || !deliveryDays) {
    showToast("All service fields are required", "warning");
    return;
  }

  upsertService(session.activeArtistId, {
    title,
    description,
    price,
    deliveryDays,
  });

  event.target.reset();
  showToast("Service added", "success");
  render();
});

render();
