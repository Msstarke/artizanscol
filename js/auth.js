import { ensureArtistForCognito, ensureUserForCognito } from "./store.js";
import {
  confirmForgotPasswordCognito,
  confirmSignUpCognito,
  ensureCognitoSession,
  forgotPasswordCognito,
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

const LAST_MODE_KEY = "artizans.last_mode.v1";
const ALLOWED_MODES = ["user", "artist"];

const authStatus = byId("auth-status");
const signedInEmail = byId("signed-in-email");
const lastLoginAt = byId("last-login-at");
const currentModeLabel = byId("current-mode-label");
const roleLockNotice = byId("role-lock-notice");

const signInForm = byId("signin-form");
const signInEmail = byId("signin-email");
const signInPassword = byId("signin-password");

const signUpForm = byId("signup-form");
const signUpEmail = byId("signup-email");
const signUpPassword = byId("signup-password");

const confirmForm = byId("confirm-form");
const confirmEmail = byId("confirm-email");
const confirmCode = byId("confirm-code");

const resetRequestForm = byId("reset-request-form");
const resetRequestEmail = byId("reset-request-email");

const resetConfirmForm = byId("reset-confirm-form");
const resetConfirmEmail = byId("reset-confirm-email");
const resetConfirmCode = byId("reset-confirm-code");
const resetConfirmPassword = byId("reset-confirm-password");

const goSignUp = byId("go-signup");
const goResetRequest = byId("go-reset-request");
const goLoginFromSignup = byId("go-login-from-signup");
const goLoginFromVerify = byId("go-login-from-verify");
const goLoginFromResetRequest = byId("go-login-from-reset-request");
const goLoginFromResetConfirm = byId("go-login-from-reset-confirm");

const continueBtn = byId("continue-btn");
const toggleModePicker = byId("toggle-mode-picker");
const modePicker = byId("mode-picker");
const openUserWorkspaceBtn = byId("open-user-workspace");
const openArtistWorkspaceBtn = byId("open-artist-workspace");

const authSignoutBtn = byId("auth-signout");
const fullSignoutBtn = byId("full-signout-btn");

const views = Array.from(document.querySelectorAll("[data-auth-view]"));

const nextParam = getQueryParam("next");
let currentView = "login";

function getLastMode() {
  const value = localStorage.getItem(LAST_MODE_KEY);
  return ALLOWED_MODES.includes(value) ? value : null;
}

function setLastMode(mode) {
  if (!ALLOWED_MODES.includes(mode)) {
    return;
  }
  localStorage.setItem(LAST_MODE_KEY, mode);
}

function clearLastMode() {
  localStorage.removeItem(LAST_MODE_KEY);
}

function titleRole(role) {
  if (role === "user") {
    return "Client";
  }
  if (role === "artist") {
    return "Artist";
  }
  return "Not selected";
}

function showView(nextView) {
  currentView = nextView;
  views.forEach((section) => {
    section.hidden = section.getAttribute("data-auth-view") !== nextView;
  });
}

function setSignedInControls(enabled) {
  [continueBtn, toggleModePicker, openUserWorkspaceBtn, openArtistWorkspaceBtn].forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.disabled = !enabled;
    }
  });

  if (roleLockNotice) {
    roleLockNotice.style.display = enabled ? "none" : "block";
  }

  if (!enabled && modePicker) {
    modePicker.hidden = true;
  }
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

function renderModeLabel(session) {
  if (!currentModeLabel) {
    return;
  }

  if (ALLOWED_MODES.includes(session.role)) {
    currentModeLabel.textContent = titleRole(session.role);
    return;
  }

  const lastMode = getLastMode();
  currentModeLabel.textContent = lastMode ? `Last used: ${titleRole(lastMode)}` : "Not selected";
}

function renderAuthStatus(session) {
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  if (authStatus) {
    authStatus.textContent = signedIn
      ? "You are signed in. Continue to your dashboard."
      : "Log in to continue.";
  }

  if (signedInEmail) {
    signedInEmail.textContent = signedIn ? session.cognitoEmail : "-";
  }

  renderLastLogin(session);
  renderModeLabel(session);
  setSignedInControls(signedIn);
}

function syncSessionFromExisting() {
  const session = getSession();
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  renderAuthStatus(session);

  if (signedIn) {
    if (!ALLOWED_MODES.includes(session.role) && modePicker) {
      modePicker.hidden = true;
    }

    if (!ALLOWED_MODES.includes(session.role) && currentView === "login") {
      showView("signed_in");
    }

    if (currentView !== "signup" && currentView !== "verify" && currentView !== "reset_request" && currentView !== "reset_confirm") {
      showView("signed_in");
    }
    return;
  }

  showView("login");
}

function getPreferredMode(session = getSession()) {
  if (ALLOWED_MODES.includes(session.role)) {
    return session.role;
  }
  return getLastMode();
}

function activateWorkspace(role, targetOverride = null) {
  if (!isCognitoAuthenticated()) {
    showToast("Sign in before opening a dashboard.", "warning");
    return;
  }

  const existing = getSession();
  if (!existing.cognitoSub) {
    showToast("Sign in again to continue.", "danger");
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
      showToast("Could not open client dashboard.", "danger");
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
      showToast("Could not open artist dashboard.", "danger");
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

  setLastMode(role);
  const target = targetOverride || nextParam || getRoleHome(role);

  showToast(role === "user" ? "Opening client dashboard..." : "Opening artist dashboard...", "success");
  window.setTimeout(() => {
    window.location.href = target;
  }, 220);
}

function handleContinue() {
  if (!isCognitoAuthenticated()) {
    showToast("Sign in before continuing.", "warning");
    return;
  }

  const session = getSession();
  const preferredMode = getPreferredMode(session);

  if (preferredMode) {
    const target = nextParam || getRoleHome(preferredMode);
    activateWorkspace(preferredMode, target);
    return;
  }

  if (modePicker) {
    modePicker.hidden = false;
  }
  showToast("Choose a dashboard to continue.", "info");
}

async function hydrateCognitoState() {
  const identity = await ensureCognitoSession();

  if (!identity) {
    clearCognitoIdentity();
    syncSessionFromExisting();
    return;
  }

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

    syncSessionFromExisting();
    showToast("Signed in. Press Continue.", "success");
  } catch (error) {
    showToast(error?.message || "Log in failed.", "danger");
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
    if (signInEmail) {
      signInEmail.value = email;
    }
    showView("verify");
    showToast("Check your email for a verification code.", "success");
  } catch (error) {
    showToast(error?.message || "Could not create account.", "danger");
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
    if (confirmCode) {
      confirmCode.value = "";
    }
    showView("login");
    showToast("Email verified. You can log in now.", "success");
  } catch (error) {
    showToast(error?.message || "Verification failed.", "danger");
  }
});

resetRequestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (resetRequestEmail?.value || "").trim();
  if (!email) {
    showToast("Email is required.", "warning");
    return;
  }

  try {
    await forgotPasswordCognito({ email });
    if (resetConfirmEmail) {
      resetConfirmEmail.value = email;
    }
    showView("reset_confirm");
    showToast("Verification code sent. Check your email.", "success");
  } catch (error) {
    showToast(error?.message || "Could not start password reset.", "danger");
  }
});

resetConfirmForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (resetConfirmEmail?.value || "").trim();
  const code = (resetConfirmCode?.value || "").trim();
  const newPassword = resetConfirmPassword?.value || "";

  if (!email || !code || !newPassword) {
    showToast("Email, verification code, and new password are required.", "warning");
    return;
  }

  try {
    await confirmForgotPasswordCognito({ email, code, newPassword });
    if (signInEmail) {
      signInEmail.value = email;
    }
    if (resetConfirmCode) {
      resetConfirmCode.value = "";
    }
    if (resetConfirmPassword) {
      resetConfirmPassword.value = "";
    }
    showView("login");
    showToast("Password updated. You can log in now.", "success");
  } catch (error) {
    showToast(error?.message || "Password reset failed.", "danger");
  }
});

goSignUp?.addEventListener("click", () => showView("signup"));
goResetRequest?.addEventListener("click", () => {
  if (resetRequestEmail && signInEmail?.value) {
    resetRequestEmail.value = signInEmail.value;
  }
  showView("reset_request");
});

goLoginFromSignup?.addEventListener("click", () => showView("login"));
goLoginFromVerify?.addEventListener("click", () => showView("login"));
goLoginFromResetRequest?.addEventListener("click", () => showView("login"));
goLoginFromResetConfirm?.addEventListener("click", () => showView("login"));

continueBtn?.addEventListener("click", handleContinue);

openUserWorkspaceBtn?.addEventListener("click", () => activateWorkspace("user"));
openArtistWorkspaceBtn?.addEventListener("click", () => activateWorkspace("artist"));

toggleModePicker?.addEventListener("click", () => {
  if (!isCognitoAuthenticated()) {
    showToast("Sign in first.", "warning");
    return;
  }
  if (!modePicker) {
    return;
  }
  modePicker.hidden = !modePicker.hidden;
});

authSignoutBtn?.addEventListener("click", async () => {
  await signOutCognito();
  clearCognitoIdentity();
  syncSessionFromExisting();
  showToast("Signed out.", "success");
});

fullSignoutBtn?.addEventListener("click", async () => {
  await signOutCognito();
  clearCognitoIdentity();
  clearLastMode();
  syncSessionFromExisting();
  showToast("Signed out and cleared.", "success");
});

showView("login");
syncSessionFromExisting();
hydrateCognitoState();
