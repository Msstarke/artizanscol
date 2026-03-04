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
import { byId, escapeHtml, getQueryParam, showToast } from "./utils.js";

initSharedPage();

const openUserWorkspaceBtn = byId("open-user-workspace");
const openArtistWorkspaceBtn = byId("open-artist-workspace");
const authStatus = byId("auth-status");
const roleLockNotice = byId("role-lock-notice");
const profileSummary = byId("profile-summary");
const lastLoginAt = byId("last-login-at");

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
const nextParam = getQueryParam("next");

function setRoleFormEnabled(enabled) {
  [openUserWorkspaceBtn, openArtistWorkspaceBtn].forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.disabled = !enabled;
    }
  });

  if (roleLockNotice) {
    roleLockNotice.style.display = enabled ? "none" : "block";
  }
}

function renderAuthStatus(session) {
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  if (authStatus) {
    authStatus.textContent = signedIn
      ? `Signed in as ${session.cognitoEmail}. Choose a dashboard to continue.`
      : "You are signed out. Sign in to continue.";
  }

  setRoleFormEnabled(signedIn);
}

function renderLastLogin(session) {
  if (!lastLoginAt) {
    return;
  }

  if (!session?.lastLoginAt) {
    lastLoginAt.textContent = "-";
    return;
  }

  const date = new Date(session.lastLoginAt);
  if (Number.isNaN(date.getTime())) {
    lastLoginAt.textContent = "-";
    return;
  }

  lastLoginAt.textContent = date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderProfileSummary(session) {
  if (!profileSummary) {
    return;
  }

  if (!isCognitoAuthenticated() || !session.cognitoSub) {
    profileSummary.innerHTML = `
      <article class="profile-summary-item">
        <small>Client profile</small>
        <strong>Sign in to load</strong>
      </article>
      <article class="profile-summary-item">
        <small>Artist profile</small>
        <strong>Sign in to load</strong>
      </article>
    `;
    return;
  }

  const db = getDB();
  const user = getUserByCognitoSub(db, session.cognitoSub);
  const artist = getArtistByCognitoSub(db, session.cognitoSub);

  const userLabel = user ? `${user.name} (${user.id})` : "Will be created on first use";
  const artistLabel = artist ? `${artist.name} (${artist.id})` : "Will be created on first use";

  profileSummary.innerHTML = `
    <article class="profile-summary-item">
      <small>Client profile</small>
      <strong>${escapeHtml(userLabel)}</strong>
    </article>
    <article class="profile-summary-item">
      <small>Artist profile</small>
      <strong>${escapeHtml(artistLabel)}</strong>
    </article>
  `;
}

function syncSessionFromExisting() {
  const existing = getSession();

  renderAuthStatus(existing);
  renderLastLogin(existing);
  renderProfileSummary(existing);
}

function activateWorkspace(role) {
  if (!isCognitoAuthenticated()) {
    showToast("Sign in before opening a dashboard.", "warning");
    return;
  }

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
    showToast("Please choose a valid dashboard.", "warning");
    return;
  }

  showToast(role === "user" ? "Opening client dashboard..." : "Opening artist dashboard...", "success");
  syncSessionFromExisting();

  const target = nextParam || getRoleHome(role);
  window.setTimeout(() => {
    window.location.href = target;
  }, 220);
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

    showToast("Signed in successfully. Choose your dashboard to continue.", "success");
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

openUserWorkspaceBtn?.addEventListener("click", () => activateWorkspace("user"));
openArtistWorkspaceBtn?.addEventListener("click", () => activateWorkspace("artist"));

syncSessionFromExisting();
hydrateCognitoState();
