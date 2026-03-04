import { getDB, getUserById, updateUserProfile } from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, showToast } from "../utils.js";

initSharedPage();
const session = requireRole(["user"]);
if (!session) {
  throw new Error("Unauthorized");
}

function loadUser() {
  const db = getDB();
  return getUserById(db, session.activeUserId);
}

const nameInput = byId("setup-name");
const emailInput = byId("setup-email");
const locationInput = byId("setup-location");
const setupKpis = byId("setup-kpis");

function render() {
  const user = loadUser();
  if (!user) return;

  if (nameInput) nameInput.value = user.name;
  if (emailInput) emailInput.value = user.email;
  if (locationInput) locationInput.value = user.location;

  if (setupKpis) {
    setupKpis.innerHTML = `
      <article class="kpi"><small>Email verification</small><strong>${user.emailVerified ? "Verified" : "Pending"}</strong></article>
      <article class="kpi"><small>Profile completion</small><strong>${user.profileCompleted ? "Complete" : "Incomplete"}</strong></article>
      <article class="kpi"><small>Saved artists</small><strong>${user.savedArtists.length}</strong></article>
      <article class="kpi"><small>Bookings</small><strong>${user.bookingHistory.length}</strong></article>
    `;
  }
}

byId("setup-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  updateUserProfile(session.activeUserId, {
    name: nameInput?.value || "",
    email: emailInput?.value || "",
    location: locationInput?.value || "",
  });
  showToast("Profile details saved", "success");
  render();
});

byId("verify-email-btn")?.addEventListener("click", () => {
  if (!assertCanMutate(session)) return;
  updateUserProfile(session.activeUserId, { emailVerified: true });
  showToast("Email marked as verified", "success");
  render();
});

byId("complete-profile-btn")?.addEventListener("click", () => {
  if (!assertCanMutate(session)) return;
  updateUserProfile(session.activeUserId, { profileCompleted: true });
  showToast("Profile marked complete", "success");
  render();
});

render();
