import {
  ensureArtistForCognito,
  ensureUserForCognito,
  getArtistByCognitoSub,
  getDB,
  getUserByCognitoSub,
} from "./store.js";
import {
  confirmSignUpCognito,
  ensureCognitoSession,
  isCognitoAuthenticated,
  signInCognito,
  signOutCognito,
  signUpCognito,
} from "./cognito-auth.js";
import {
  clearCognitoIdentity,
  getRoleHome,
  getSession,
  loginAsRole,
  setCognitoIdentity,
  setSession,
} from "./session.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, getQueryParam, showToast } from "./utils.js";

initSharedPage();

const form = byId("role-form");
const roleSelect = byId("role-select");
const authStatus = byId("auth-status");
const roleLockNotice = byId("role-lock-notice");
const profileSummary = byId("profile-summary");

const signInForm = byId("signin-form");
const signInEmail = byId("signin-email");
const signInPassword = byId("signin-password");

const signUpForm = byId("signup-form");
const signUpEmail = byId("signup-email");
const signUpPassword = byId("signup-password");

const confirmForm = byId("confirm-form");
const confirmEmail = byId("confirm-email");
const confirmCode = byId("confirm-code");

const cognitoLogout = byId("cognito-logout");

function setRoleFormEnabled(enabled) {
  if (form) {
    Array.from(form.elements).forEach((element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLButtonElement) {
        element.disabled = !enabled;
      }
    });
  }

  if (roleLockNotice) {
    roleLockNotice.style.display = enabled ? "none" : "block";
  }
}

function renderAuthStatus(session) {
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  if (authStatus) {
    authStatus.textContent = signedIn
      ? `Signed in as ${session.cognitoEmail}`
      : "Not signed in. Sign in with Cognito to continue.";
  }

  setRoleFormEnabled(signedIn);
}

function renderProfileSummary(session) {
  if (!profileSummary) {
    return;
  }

  if (!isCognitoAuthenticated() || !session.cognitoSub) {
    profileSummary.innerHTML = "<li>Sign in to view linked user and artist profiles.</li>";
    return;
  }

  const db = getDB();
  const user = getUserByCognitoSub(db, session.cognitoSub);
  const artist = getArtistByCognitoSub(db, session.cognitoSub);

  profileSummary.innerHTML = [
    `<li>User profile: ${user ? `${user.name} (${user.id})` : "Not created yet"}</li>`,
    `<li>Artist profile: ${artist ? `${artist.name} (${artist.id})` : "Not created yet"}</li>`,
    `<li>Tip: selecting a role creates the missing profile automatically.</li>`,
  ].join("");
}

function syncSessionFromExisting() {
  const existing = getSession();

  if (roleSelect) {
    const allowed = ["user", "artist"];
    roleSelect.value = allowed.includes(existing.role) ? existing.role : "user";
  }

  renderAuthStatus(existing);
  renderProfileSummary(existing);
}

async function hydrateCognitoState() {
  const identity = await ensureCognitoSession();

  if (identity) {
    setCognitoIdentity(identity);

    const existing = getSession();
    if (existing.role === "user") {
      const user = ensureUserForCognito(identity);
      if (user) {
        loginAsRole("user", {
          activeUserId: user.id,
          cognitoEmail: identity.email,
          cognitoSub: identity.sub,
          cognitoUsername: identity.username,
        });
      }
    }

    if (existing.role === "artist") {
      const artist = ensureArtistForCognito(identity);
      if (artist) {
        loginAsRole("artist", {
          activeArtistId: artist.id,
          cognitoEmail: identity.email,
          cognitoSub: identity.sub,
          cognitoUsername: identity.username,
        });
      }
    }

    syncSessionFromExisting();
    return;
  }

  clearCognitoIdentity();
  syncSessionFromExisting();
}

signInForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (signInEmail?.value || "").trim();
  const password = signInPassword?.value || "";

  if (!email || !password) {
    showToast("Email and password are required.", "warning");
    return;
  }

  try {
    const identity = await signInCognito({ email, password });

    setSession({
      ...getSession(),
      role: "none",
      activeUserId: null,
      activeArtistId: null,
      cognitoEmail: identity?.email || null,
      cognitoSub: identity?.sub || null,
      cognitoUsername: identity?.username || null,
      lastLoginAt: new Date().toISOString(),
    });

    if (signInPassword) {
      signInPassword.value = "";
    }

    showToast("Signed in with Cognito. Select account role to continue.", "success");
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Cognito sign-in failed.", "danger");
  }
});

signUpForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (signUpEmail?.value || "").trim();
  const password = signUpPassword?.value || "";

  if (!email || !password) {
    showToast("Email and password are required.", "warning");
    return;
  }

  try {
    await signUpCognito({ email, password });
    if (confirmEmail) {
      confirmEmail.value = email;
    }
    showToast("Sign-up created. Check your email for the verification code.", "success");
  } catch (error) {
    showToast(error?.message || "Cognito sign-up failed.", "danger");
  }
});

confirmForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (confirmEmail?.value || "").trim();
  const code = (confirmCode?.value || "").trim();

  if (!email || !code) {
    showToast("Email and verification code are required.", "warning");
    return;
  }

  try {
    await confirmSignUpCognito({ email, code });
    showToast("Email verified. You can sign in now.", "success");
  } catch (error) {
    showToast(error?.message || "Verification failed.", "danger");
  }
});

cognitoLogout?.addEventListener("click", async () => {
  await signOutCognito();
  clearCognitoIdentity();
  showToast("Signed out.", "success");
  syncSessionFromExisting();
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!isCognitoAuthenticated()) {
    showToast("Sign in with Cognito before selecting an account.", "warning");
    return;
  }

  const role = roleSelect?.value || "user";
  const nextParam = getQueryParam("next");
  const existing = getSession();

  if (!existing.cognitoSub) {
    showToast("Missing Cognito identity. Please sign in again.", "danger");
    return;
  }

  let session = null;

  if (role === "user") {
    const user = ensureUserForCognito({
      sub: existing.cognitoSub,
      email: existing.cognitoEmail,
      username: existing.cognitoUsername,
    });

    if (!user) {
      showToast("Could not create user profile.", "danger");
      return;
    }

    session = loginAsRole("user", {
      activeUserId: user.id,
      cognitoEmail: existing.cognitoEmail,
      cognitoSub: existing.cognitoSub,
      cognitoUsername: existing.cognitoUsername,
    });
  }

  if (role === "artist") {
    const artist = ensureArtistForCognito({
      sub: existing.cognitoSub,
      email: existing.cognitoEmail,
      username: existing.cognitoUsername,
    });

    if (!artist) {
      showToast("Could not create artist profile.", "danger");
      return;
    }

    session = loginAsRole("artist", {
      activeArtistId: artist.id,
      cognitoEmail: existing.cognitoEmail,
      cognitoSub: existing.cognitoSub,
      cognitoUsername: existing.cognitoUsername,
    });
  }

  if (!session) {
    showToast("Please select a valid role.", "warning");
    return;
  }

  showToast(`Account selected: ${session.role}.`, "success");
  syncSessionFromExisting();

  const target = nextParam || getRoleHome(role);
  window.setTimeout(() => {
    window.location.href = target;
  }, 220);
});

syncSessionFromExisting();
hydrateCognitoState();
