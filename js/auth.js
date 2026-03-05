import {
  ensureArtistForCognito,
  ensureUserForCognito,
  getArtistById,
  getDB,
  hydrateDB,
  getUserById,
  updateArtistProfile,
  updateUserProfile,
} from "./store.js";
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
import { clearCognitoIdentity, getSession, setCognitoIdentity, setSession } from "./session.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, getQueryParam, normalizeInternalPath, showToast } from "./utils.js";

initSharedPage();
await hydrateDB();

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

const authSignoutBtn = byId("auth-signout");
const fullSignoutBtn = byId("full-signout-btn");
const accountProfileForm = byId("account-profile-form");
const accountName = byId("account-name");
const accountLocation = byId("account-location");
const accountBio = byId("account-bio");

const accountPreferencesForm = byId("account-preferences-form");
const prefBookingUpdates = byId("pref-booking-updates");
const prefMessageAlerts = byId("pref-message-alerts");
const prefMarketingEmails = byId("pref-marketing-emails");
const enableBrowserNotificationsBtn = byId("enable-browser-notifications");

const statSavedArtists = byId("stat-saved-artists");
const statTotalBookings = byId("stat-total-bookings");
const statUnreadUpdates = byId("stat-unread-updates");

const openResetFromSettingsBtn = byId("open-reset-from-settings");
const exportAccountDataBtn = byId("export-account-data");
const clearSavedArtistsBtn = byId("clear-saved-artists");

const views = Array.from(document.querySelectorAll("[data-auth-view]"));

const nextParam = getQueryParam("next");
let currentView = "login";
const ACCOUNT_PREFERENCES_KEY = "artizans.account.preferences.v1";
const DEFAULT_ACCOUNT_PREFERENCES = {
  bookingUpdates: true,
  messageAlerts: true,
  marketingEmails: false,
};

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function titleize(value) {
  return String(value || "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function preferenceOwnerKey(session) {
  if (session?.cognitoSub) {
    return `sub:${session.cognitoSub}`;
  }
  if (session?.cognitoEmail) {
    return `email:${String(session.cognitoEmail).toLowerCase()}`;
  }
  return null;
}

function getPreferenceStore() {
  return safeParse(localStorage.getItem(ACCOUNT_PREFERENCES_KEY)) || {};
}

function savePreferenceStore(store) {
  localStorage.setItem(ACCOUNT_PREFERENCES_KEY, JSON.stringify(store));
}

function getAccountPreferences(session) {
  const ownerKey = preferenceOwnerKey(session);
  if (!ownerKey) {
    return { ...DEFAULT_ACCOUNT_PREFERENCES };
  }

  const store = getPreferenceStore();
  return {
    ...DEFAULT_ACCOUNT_PREFERENCES,
    ...(store[ownerKey] || {}),
  };
}

function setAccountPreferences(session, preferences) {
  const ownerKey = preferenceOwnerKey(session);
  if (!ownerKey) {
    return;
  }

  const store = getPreferenceStore();
  store[ownerKey] = {
    ...DEFAULT_ACCOUNT_PREFERENCES,
    ...(preferences || {}),
  };
  savePreferenceStore(store);
}

function clearAccountPreferences(session) {
  const ownerKey = preferenceOwnerKey(session);
  if (!ownerKey) {
    return;
  }

  const store = getPreferenceStore();
  if (!Object.prototype.hasOwnProperty.call(store, ownerKey)) {
    return;
  }

  delete store[ownerKey];
  savePreferenceStore(store);
}

function signedInContext(session = getSession()) {
  if (!isCognitoAuthenticated() || !session?.cognitoEmail) {
    return null;
  }

  const db = getDB();
  return {
    db,
    user: getUserById(db, session.activeUserId),
    artist: getArtistById(db, session.activeArtistId),
    session,
  };
}

function setElementDisabled(element, disabled) {
  if (element && "disabled" in element) {
    element.disabled = disabled;
  }
}

function setSettingsInteractive(enabled) {
  const disabled = !enabled;

  [accountName, accountLocation, accountBio].forEach((element) => setElementDisabled(element, disabled));
  [prefBookingUpdates, prefMessageAlerts, prefMarketingEmails].forEach((element) =>
    setElementDisabled(element, disabled),
  );
  [
    continueBtn,
    enableBrowserNotificationsBtn,
    openResetFromSettingsBtn,
    exportAccountDataBtn,
    clearSavedArtistsBtn,
  ].forEach((element) => setElementDisabled(element, disabled));
}

function writeText(node, value) {
  if (!node) {
    return;
  }
  node.textContent = String(value);
}

function renderHeaderSessionState(session) {
  const text = session?.cognitoEmail ? `Signed in: ${session.cognitoEmail}` : "Session: signed out";

  document.querySelectorAll("[data-role-chip]").forEach((node) => {
    node.textContent = text;
  });
}

function renderAccountPanels(session) {
  const context = signedInContext(session);

  if (!context) {
    setSettingsInteractive(false);
    if (accountName instanceof HTMLInputElement) {
      accountName.value = "";
    }
    if (accountLocation instanceof HTMLInputElement) {
      accountLocation.value = "";
    }
    if (accountBio instanceof HTMLTextAreaElement) {
      accountBio.value = "";
    }
    if (prefBookingUpdates instanceof HTMLInputElement) {
      prefBookingUpdates.checked = DEFAULT_ACCOUNT_PREFERENCES.bookingUpdates;
    }
    if (prefMessageAlerts instanceof HTMLInputElement) {
      prefMessageAlerts.checked = DEFAULT_ACCOUNT_PREFERENCES.messageAlerts;
    }
    if (prefMarketingEmails instanceof HTMLInputElement) {
      prefMarketingEmails.checked = DEFAULT_ACCOUNT_PREFERENCES.marketingEmails;
    }
    writeText(statSavedArtists, 0);
    writeText(statTotalBookings, 0);
    writeText(statUnreadUpdates, 0);
    return;
  }

  setSettingsInteractive(true);

  const { db, user, artist } = context;
  const fallbackName = titleize(
    session.cognitoUsername || String(session.cognitoEmail || "").split("@")[0] || "Member",
  );
  const preferences = getAccountPreferences(session);

  if (accountName instanceof HTMLInputElement) {
    accountName.value = user?.name || artist?.name || fallbackName;
  }

  if (accountLocation instanceof HTMLInputElement) {
    accountLocation.value = user?.location || artist?.location || "";
  }

  if (accountBio instanceof HTMLTextAreaElement) {
    accountBio.value = artist?.bio || "";
  }

  if (prefBookingUpdates instanceof HTMLInputElement) {
    prefBookingUpdates.checked = Boolean(preferences.bookingUpdates);
  }

  if (prefMessageAlerts instanceof HTMLInputElement) {
    prefMessageAlerts.checked = Boolean(preferences.messageAlerts);
  }

  if (prefMarketingEmails instanceof HTMLInputElement) {
    prefMarketingEmails.checked = Boolean(preferences.marketingEmails);
  }

  const savedArtistsCount = Array.isArray(user?.savedArtists) ? user.savedArtists.length : 0;
  writeText(statSavedArtists, savedArtistsCount);

  const bookingIds = new Set();
  db.bookings.forEach((booking) => {
    if ((user && booking.userId === user.id) || (artist && booking.artistId === artist.id)) {
      bookingIds.add(booking.id);
    }
  });
  writeText(statTotalBookings, bookingIds.size);

  const unreadCount = db.notifications.filter(
    (notification) =>
      !notification.read &&
      ((user && notification.role === "user" && notification.ownerId === user.id) ||
        (artist && notification.role === "artist" && notification.ownerId === artist.id)),
  ).length;
  writeText(statUnreadUpdates, unreadCount);
}

function showView(nextView) {
  currentView = nextView;
  views.forEach((section) => {
    section.hidden = section.getAttribute("data-auth-view") !== nextView;
  });
}

function setSignedInControls(enabled) {
  if (continueBtn instanceof HTMLButtonElement) {
    continueBtn.disabled = !enabled;
  }

  if (roleLockNotice) {
    roleLockNotice.style.display = enabled ? "none" : "block";
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

function renderAuthStatus(session) {
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  if (authStatus) {
    authStatus.textContent = signedIn
      ? "You are signed in. Continue to the platform."
      : "Log in to continue.";
  }

  if (signedInEmail) {
    signedInEmail.textContent = signedIn ? session.cognitoEmail : "-";
  }

  renderLastLogin(session);

  if (currentModeLabel) {
    currentModeLabel.textContent = signedIn ? "Universal access" : "Sign in required";
  }

  renderHeaderSessionState(session);
  setSignedInControls(signedIn);
  renderAccountPanels(session);
}

function isInlineAuthFlow(viewName) {
  return ["signup", "verify", "reset_request", "reset_confirm"].includes(viewName);
}

function syncSessionFromExisting() {
  let session = getSession();
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  if (signedIn) {
    session = ensureLinkedProfiles(session);
  }

  renderAuthStatus(session);

  if (signedIn) {
    if (!isInlineAuthFlow(currentView)) {
      showView("signed_in");
    }
    return;
  }

  showView("login");
}

function ensureLinkedProfiles(session) {
  if (!session?.cognitoSub) {
    return session;
  }

  const identity = {
    sub: session.cognitoSub,
    email: session.cognitoEmail,
    username: session.cognitoUsername,
  };

  const user = ensureUserForCognito(identity);
  const artist = ensureArtistForCognito(identity);

  return setSession({
    ...session,
    role: "none",
    activeUserId: user?.id || session.activeUserId || null,
    activeArtistId: artist?.id || session.activeArtistId || null,
    cognitoEmail: identity.email || null,
    cognitoSub: identity.sub || null,
    cognitoUsername: identity.username || null,
  });
}

function getContinueTarget() {
  return normalizeInternalPath(nextParam, "/explore.html");
}

function handleContinue() {
  if (!isCognitoAuthenticated()) {
    showToast("Sign in before continuing.", "warning");
    return;
  }

  const session = ensureLinkedProfiles(getSession());
  if (!session?.activeUserId || !session?.activeArtistId) {
    showToast("Account setup is not complete. Please sign in again.", "danger");
    return;
  }

  window.location.href = getContinueTarget();
}

async function hydrateCognitoState() {
  const identity = await ensureCognitoSession();

  if (!identity) {
    clearCognitoIdentity();
    syncSessionFromExisting();
    return;
  }

  setCognitoIdentity(identity);

  ensureLinkedProfiles({
    ...getSession(),
    cognitoEmail: identity.email || null,
    cognitoSub: identity.sub || null,
    cognitoUsername: identity.username || null,
    lastLoginAt: getSession().lastLoginAt || new Date().toISOString(),
  });

  syncSessionFromExisting();
}

function buildAccountExport(context) {
  const { db, user, artist, session } = context;
  const ownerIds = new Set();

  if (user?.id) {
    ownerIds.add(user.id);
  }
  if (artist?.id) {
    ownerIds.add(artist.id);
  }

  const notifications = db.notifications.filter(
    (notification) =>
      (user && notification.role === "user" && notification.ownerId === user.id) ||
      (artist && notification.role === "artist" && notification.ownerId === artist.id),
  );

  const bookings = db.bookings.filter(
    (booking) => (user && booking.userId === user.id) || (artist && booking.artistId === artist.id),
  );

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: session.cognitoEmail || null,
      cognitoSub: session.cognitoSub || null,
      userId: user?.id || null,
      artistId: artist?.id || null,
    },
    profile: {
      user: user || null,
      artist: artist || null,
    },
    preferences: getAccountPreferences(session),
    savedArtists: db.artists.filter((candidate) => Array.isArray(user?.savedArtists) && user.savedArtists.includes(candidate.id)),
    bookings,
    messages: db.messages.filter((message) => ownerIds.has(message.fromId) || ownerIds.has(message.toId)),
    notifications,
    invoices: db.invoices.filter(
      (invoice) => (user && invoice.userId === user.id) || (artist && invoice.artistId === artist.id),
    ),
    payouts: db.payouts.filter((payout) => artist && payout.artistId === artist.id),
  };
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
    const user = ensureUserForCognito(identity);
    const artist = ensureArtistForCognito(identity);

    setSession({
      ...getSession(),
      role: "none",
      activeUserId: user?.id || null,
      activeArtistId: artist?.id || null,
      cognitoEmail: identity?.email || null,
      cognitoSub: identity?.sub || null,
      cognitoUsername: identity?.username || null,
      lastLoginAt: new Date().toISOString(),
    });

    if (signInPassword) {
      signInPassword.value = "";
    }

    syncSessionFromExisting();
    showToast("Signed in.", "success");
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

accountProfileForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const session = ensureLinkedProfiles(getSession());
  const context = signedInContext(session);
  if (!context) {
    showToast("Sign in to update profile details.", "warning");
    return;
  }

  const name = (accountName?.value || "").trim();
  const location = (accountLocation?.value || "").trim();
  const bio = (accountBio?.value || "").trim();

  if (!name) {
    showToast("Display name is required.", "warning");
    return;
  }

  if (context.user?.id) {
    updateUserProfile(context.user.id, {
      name,
      location,
      profileCompleted: true,
    });
  }

  if (context.artist?.id) {
    updateArtistProfile(context.artist.id, {
      name,
      location,
      bio,
    });
  }

  syncSessionFromExisting();
  showToast("Profile saved.", "success");
});

accountPreferencesForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const session = getSession();
  if (!isCognitoAuthenticated() || !session.cognitoEmail) {
    showToast("Sign in to update preferences.", "warning");
    return;
  }

  setAccountPreferences(session, {
    bookingUpdates: Boolean(prefBookingUpdates?.checked),
    messageAlerts: Boolean(prefMessageAlerts?.checked),
    marketingEmails: Boolean(prefMarketingEmails?.checked),
  });
  showToast("Preferences saved.", "success");
});

enableBrowserNotificationsBtn?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Browser notifications are not supported on this device.", "warning");
    return;
  }

  if (Notification.permission === "granted") {
    showToast("Browser alerts are already enabled.", "success");
    return;
  }

  if (Notification.permission === "denied") {
    showToast("Browser alerts are blocked in browser settings.", "warning");
    return;
  }

  const result = await Notification.requestPermission();
  if (result === "granted") {
    showToast("Browser alerts enabled.", "success");
    return;
  }

  showToast("Browser alerts were not enabled.", "warning");
});

openResetFromSettingsBtn?.addEventListener("click", () => {
  const session = getSession();
  if (resetRequestEmail && session?.cognitoEmail) {
    resetRequestEmail.value = session.cognitoEmail;
  }
  showView("reset_request");
});

exportAccountDataBtn?.addEventListener("click", () => {
  const session = ensureLinkedProfiles(getSession());
  const context = signedInContext(session);
  if (!context) {
    showToast("Sign in before exporting account data.", "warning");
    return;
  }

  const payload = buildAccountExport(context);
  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadJsonFile(`artizans-account-${dateStamp}.json`, payload);
  showToast("Account data export generated.", "success");
});

clearSavedArtistsBtn?.addEventListener("click", () => {
  const session = ensureLinkedProfiles(getSession());
  const context = signedInContext(session);
  if (!context?.user?.id) {
    showToast("No saved artists found for this account.", "warning");
    return;
  }

  updateUserProfile(context.user.id, {
    savedArtists: [],
  });
  syncSessionFromExisting();
  showToast("Saved artists cleared.", "success");
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

authSignoutBtn?.addEventListener("click", async () => {
  await signOutCognito();
  clearCognitoIdentity();
  syncSessionFromExisting();
  showToast("Signed out.", "success");
});

fullSignoutBtn?.addEventListener("click", async () => {
  const session = getSession();
  await signOutCognito();
  clearCognitoIdentity();
  clearAccountPreferences(session);
  localStorage.removeItem("artizans.last_mode.v1");
  syncSessionFromExisting();
  showToast("Signed out and cleared.", "success");
});

showView("login");
syncSessionFromExisting();
hydrateCognitoState();
