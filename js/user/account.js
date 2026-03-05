import { deleteUserAccount, getDB, getUserById, hydrateDB, updateUserProfile } from "../store.js";
import { logout } from "../session.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, showToast } from "../utils.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["user"]);
if (!session) throw new Error("Unauthorized");

const nameInput = byId("account-name");
const emailInput = byId("account-email");
const locationInput = byId("account-location");

function render() {
  const db = getDB();
  const user = getUserById(db, session.activeUserId);
  if (!user) return;

  if (nameInput) nameInput.value = user.name;
  if (emailInput) emailInput.value = user.email;
  if (locationInput) locationInput.value = user.location;
}

byId("profile-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  updateUserProfile(session.activeUserId, {
    name: nameInput?.value || "",
    email: emailInput?.value || "",
    location: locationInput?.value || "",
  });
  showToast("Profile updated", "success");
  render();
});

byId("password-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;
  const password = byId("new-password")?.value || "";
  if (password.length < 6) {
    showToast("Use at least 6 characters", "warning");
    return;
  }
  updateUserProfile(session.activeUserId, {
    passwordChangedAt: new Date().toISOString(),
  });
  const passwordInput = byId("new-password");
  if (passwordInput) {
    passwordInput.value = "";
  }
  showToast("Password update recorded", "success");
});

byId("delete-account")?.addEventListener("click", () => {
  if (!assertCanMutate(session)) return;

  const deleted = deleteUserAccount(session.activeUserId);
  if (!deleted) {
    showToast("Could not delete account", "danger");
    return;
  }

  showToast("Account deleted", "warning");
  logout();
  window.setTimeout(() => {
    window.location.href = "/account-settings.html";
  }, 300);
});

render();
