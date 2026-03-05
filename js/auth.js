import {
  ensureArtistForCognito,
  ensureUserForCognito,
  getArtistById,
  getDB,
  getServicesForArtist,
  hydrateDB,
  markNotificationsRead,
  removeService,
  sendMessage,
  toggleSaveArtist,
  updateBookingStatus,
  getUserById,
  upsertService,
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
import { byId, showToast } from "./utils.js";

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
const statUserBookings = byId("stat-user-bookings");
const statArtistBookings = byId("stat-artist-bookings");
const statActiveServices = byId("stat-active-services");
const statUnreadUpdates = byId("stat-unread-updates");

const openResetFromSettingsBtn = byId("open-reset-from-settings");
const exportAccountDataBtn = byId("export-account-data");
const clearSavedArtistsBtn = byId("clear-saved-artists");
const workspaceRefreshBtn = byId("workspace-refresh-btn");

const workspaceSavedArtists = byId("workspace-saved-artists");
const workspaceSavedEmpty = byId("workspace-saved-empty");
const workspaceBookingsList = byId("workspace-bookings-list");
const workspaceBookingsEmpty = byId("workspace-bookings-empty");
const workspaceServiceForm = byId("workspace-service-form");
const workspaceServiceId = byId("workspace-service-id");
const workspaceServiceTitle = byId("workspace-service-title");
const workspaceServiceDescription = byId("workspace-service-description");
const workspaceServicePrice = byId("workspace-service-price");
const workspaceServiceDelivery = byId("workspace-service-delivery");
const workspaceServiceReset = byId("workspace-service-reset");
const workspaceServicesList = byId("workspace-services-list");
const workspaceServicesEmpty = byId("workspace-services-empty");
const workspaceMessageForm = byId("workspace-message-form");
const workspaceMessageBooking = byId("workspace-message-booking");
const workspaceMessageBody = byId("workspace-message-body");
const workspaceMessagesList = byId("workspace-messages-list");
const workspaceMessagesEmpty = byId("workspace-messages-empty");
const workspaceNotificationsList = byId("workspace-notifications-list");
const workspaceNotificationsEmpty = byId("workspace-notifications-empty");
const workspaceMarkNotificationsRead = byId("workspace-mark-notifications-read");

const views = Array.from(document.querySelectorAll("[data-auth-view]"));

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
    workspaceRefreshBtn,
    enableBrowserNotificationsBtn,
    openResetFromSettingsBtn,
    exportAccountDataBtn,
    clearSavedArtistsBtn,
    workspaceServiceTitle,
    workspaceServiceDescription,
    workspaceServicePrice,
    workspaceServiceDelivery,
    workspaceServiceReset,
    workspaceMessageBooking,
    workspaceMessageBody,
    workspaceMarkNotificationsRead,
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

function formatDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return "A$0";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function clearNode(node) {
  if (!node) {
    return;
  }
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function normalizeStatusLabel(status) {
  const text = String(status || "").trim();
  if (!text) {
    return "Unknown";
  }
  return text
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function setCollectionEmptyState(node, emptyNode, isEmpty, emptyText) {
  if (node) {
    node.hidden = isEmpty;
  }
  if (emptyNode) {
    emptyNode.hidden = !isEmpty;
    if (emptyText) {
      emptyNode.textContent = emptyText;
    }
  }
}

function resetServiceEditor() {
  if (workspaceServiceId instanceof HTMLInputElement) {
    workspaceServiceId.value = "";
  }
  if (workspaceServiceTitle instanceof HTMLInputElement) {
    workspaceServiceTitle.value = "";
  }
  if (workspaceServiceDescription instanceof HTMLTextAreaElement) {
    workspaceServiceDescription.value = "";
  }
  if (workspaceServicePrice instanceof HTMLInputElement) {
    workspaceServicePrice.value = "";
  }
  if (workspaceServiceDelivery instanceof HTMLInputElement) {
    workspaceServiceDelivery.value = "";
  }
}

function bookingActionsForContext(booking, context) {
  const actions = [];
  const isUserBooking = Boolean(context.user && booking.userId === context.user.id);
  const isArtistBooking = Boolean(context.artist && booking.artistId === context.artist.id);

  if (isArtistBooking && booking.status === "requested") {
    actions.push({ label: "Accept", status: "accepted", actorRole: "artist" });
    actions.push({ label: "Decline", status: "declined", actorRole: "artist" });
  }

  if (isUserBooking && booking.status === "accepted") {
    actions.push({ label: "Confirm", status: "confirmed", actorRole: "user" });
  }

  if (isUserBooking && (booking.status === "confirmed" || booking.status === "payment_pending")) {
    actions.push({ label: "Mark paid", status: "paid", actorRole: "user" });
  }

  if (isUserBooking && booking.status === "paid") {
    actions.push({ label: "Complete", status: "completed", actorRole: "user" });
  }

  if (
    (isUserBooking || isArtistBooking) &&
    ["requested", "accepted", "confirmed", "payment_pending", "paid"].includes(booking.status)
  ) {
    actions.push({ label: "Cancel", status: "cancelled", actorRole: isArtistBooking ? "artist" : "user" });
  }

  return actions;
}

function renderSavedArtists(context) {
  clearNode(workspaceSavedArtists);

  const saved = context.user?.savedArtists || [];
  const artists = context.db.artists.filter((artist) => saved.includes(artist.id));
  const empty = artists.length === 0;
  setCollectionEmptyState(workspaceSavedArtists, workspaceSavedEmpty, empty, "No saved artists yet.");
  if (empty || !workspaceSavedArtists) {
    return;
  }

  artists.forEach((artist) => {
    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const title = document.createElement("h4");
    title.textContent = artist.name || "Artist";
    item.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${artist.category || "Category"} · ${artist.location || "Location pending"}`;
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    const viewLink = document.createElement("a");
    viewLink.className = "btn btn-outline btn-small";
    viewLink.href = `/artist-preview.html?id=${encodeURIComponent(artist.id)}`;
    viewLink.textContent = "View";
    actions.appendChild(viewLink);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost btn-small";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      toggleSaveArtist(context.user?.id, artist.id);
      syncSessionFromExisting();
      showToast("Saved artist removed.", "success");
    });
    actions.appendChild(removeBtn);

    item.appendChild(actions);
    workspaceSavedArtists.appendChild(item);
  });
}

function renderBookings(context) {
  clearNode(workspaceBookingsList);

  const bookings = context.db.bookings
    .filter(
      (booking) =>
        (context.user && booking.userId === context.user.id) ||
        (context.artist && booking.artistId === context.artist.id),
    )
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

  const empty = bookings.length === 0;
  setCollectionEmptyState(workspaceBookingsList, workspaceBookingsEmpty, empty, "No bookings yet.");
  if (empty || !workspaceBookingsList) {
    return;
  }

  bookings.forEach((booking) => {
    const artist = context.db.artists.find((item) => item.id === booking.artistId);
    const user = context.db.users.find((item) => item.id === booking.userId);
    const service = context.db.services.find((item) => item.id === booking.serviceId);

    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const heading = document.createElement("h4");
    heading.textContent = `${service?.title || "Service"} · ${booking.id}`;
    item.appendChild(heading);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${formatCurrency(booking.budget)} · Due ${booking.deadline || "-"} · Client ${user?.name || "-"} · Artist ${artist?.name || "-"}`;
    item.appendChild(detail);

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";
    const status = document.createElement("span");
    status.className = `status-badge status-${booking.status}`;
    status.textContent = normalizeStatusLabel(booking.status);
    metaRow.appendChild(status);

    const updatedAt = document.createElement("span");
    updatedAt.textContent = `Updated ${formatDateTime(booking.updatedAt)}`;
    metaRow.appendChild(updatedAt);
    item.appendChild(metaRow);

    const actions = bookingActionsForContext(booking, context);
    if (actions.length) {
      const actionRow = document.createElement("div");
      actionRow.className = "form-actions";
      actions.forEach((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action.status === "cancelled" ? "btn btn-ghost btn-small" : "btn btn-outline btn-small";
        button.textContent = action.label;
        button.addEventListener("click", () => {
          const result = updateBookingStatus(booking.id, action.status, action.actorRole);
          if (!result.ok) {
            showToast("Booking status update failed.", "warning");
            return;
          }
          syncSessionFromExisting();
          showToast(`Booking updated to ${normalizeStatusLabel(action.status)}.`, "success");
        });
        actionRow.appendChild(button);
      });
      item.appendChild(actionRow);
    }

    workspaceBookingsList.appendChild(item);
  });
}

function renderServices(context) {
  clearNode(workspaceServicesList);

  const artistId = context.artist?.id;
  if (!artistId) {
    setCollectionEmptyState(
      workspaceServicesList,
      workspaceServicesEmpty,
      true,
      "Artist profile unavailable. Re-sign in to manage services.",
    );
    return;
  }

  const services = getServicesForArtist(context.db, artistId).sort((a, b) =>
    String(a.title || "").localeCompare(String(b.title || ""), "en"),
  );

  const empty = services.length === 0;
  setCollectionEmptyState(workspaceServicesList, workspaceServicesEmpty, empty, "No services yet.");
  if (empty || !workspaceServicesList) {
    return;
  }

  services.forEach((service) => {
    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const title = document.createElement("h4");
    title.textContent = service.title;
    item.appendChild(title);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${formatCurrency(service.price)} · ${service.deliveryDays} day delivery`;
    item.appendChild(detail);

    const description = document.createElement("p");
    description.textContent = service.description || "";
    item.appendChild(description);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-outline btn-small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      if (workspaceServiceId instanceof HTMLInputElement) {
        workspaceServiceId.value = service.id;
      }
      if (workspaceServiceTitle instanceof HTMLInputElement) {
        workspaceServiceTitle.value = service.title || "";
      }
      if (workspaceServiceDescription instanceof HTMLTextAreaElement) {
        workspaceServiceDescription.value = service.description || "";
      }
      if (workspaceServicePrice instanceof HTMLInputElement) {
        workspaceServicePrice.value = String(service.price || "");
      }
      if (workspaceServiceDelivery instanceof HTMLInputElement) {
        workspaceServiceDelivery.value = String(service.deliveryDays || "");
      }
      workspaceServiceTitle?.focus();
    });
    actions.appendChild(editBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-ghost btn-small";
    removeBtn.textContent = "Delete";
    removeBtn.addEventListener("click", () => {
      removeService(artistId, service.id);
      syncSessionFromExisting();
      showToast("Service removed.", "success");
    });
    actions.appendChild(removeBtn);

    item.appendChild(actions);
    workspaceServicesList.appendChild(item);
  });
}

function renderMessageOptions(context, relatedBookings) {
  clearNode(workspaceMessageBooking);
  if (!workspaceMessageBooking) {
    return;
  }

  if (!relatedBookings.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No booking threads available";
    workspaceMessageBooking.appendChild(option);
    workspaceMessageBooking.disabled = true;
    return;
  }

  workspaceMessageBooking.disabled = false;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select booking thread";
  workspaceMessageBooking.appendChild(placeholder);

  relatedBookings.forEach((booking) => {
    const service = context.db.services.find((item) => item.id === booking.serviceId);
    const option = document.createElement("option");
    option.value = booking.id;
    option.textContent = `${booking.id} · ${service?.title || "Service"} · ${normalizeStatusLabel(booking.status)}`;
    workspaceMessageBooking.appendChild(option);
  });
}

function renderMessages(context) {
  clearNode(workspaceMessagesList);
  const ownerIds = new Set([context.user?.id, context.artist?.id].filter(Boolean));

  const messages = context.db.messages
    .filter((message) => ownerIds.has(message.fromId) || ownerIds.has(message.toId))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 20);

  const empty = messages.length === 0;
  setCollectionEmptyState(workspaceMessagesList, workspaceMessagesEmpty, empty, "No messages yet.");
  if (empty || !workspaceMessagesList) {
    return;
  }

  messages.forEach((message) => {
    const fromUser = context.db.users.find((item) => item.id === message.fromId);
    const fromArtist = context.db.artists.find((item) => item.id === message.fromId);
    const mine = message.fromId === context.user?.id || message.fromId === context.artist?.id;

    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const title = document.createElement("h4");
    title.textContent = `${mine ? "You" : fromUser?.name || fromArtist?.name || "Member"} · ${formatDateTime(message.createdAt)}`;
    item.appendChild(title);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = message.bookingId ? `Thread ${message.bookingId}` : "General thread";
    item.appendChild(detail);

    const body = document.createElement("p");
    body.textContent = message.body || "";
    item.appendChild(body);

    workspaceMessagesList.appendChild(item);
  });
}

function renderNotifications(context) {
  clearNode(workspaceNotificationsList);

  const notifications = context.db.notifications
    .filter(
      (notification) =>
        (context.user && notification.role === "user" && notification.ownerId === context.user.id) ||
        (context.artist && notification.role === "artist" && notification.ownerId === context.artist.id),
    )
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 24);

  const empty = notifications.length === 0;
  setCollectionEmptyState(
    workspaceNotificationsList,
    workspaceNotificationsEmpty,
    empty,
    "No notifications yet.",
  );
  if (empty || !workspaceNotificationsList) {
    return;
  }

  notifications.forEach((notification) => {
    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const title = document.createElement("h4");
    title.textContent = notification.title || "Update";
    item.appendChild(title);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${normalizeStatusLabel(notification.type || "update")} · ${formatDateTime(notification.createdAt)}`;
    item.appendChild(detail);

    const body = document.createElement("p");
    body.textContent = notification.detail || "";
    item.appendChild(body);

    workspaceNotificationsList.appendChild(item);
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
    resetServiceEditor();
    writeText(statSavedArtists, 0);
    writeText(statUserBookings, 0);
    writeText(statArtistBookings, 0);
    writeText(statActiveServices, 0);
    writeText(statUnreadUpdates, 0);
    clearNode(workspaceSavedArtists);
    clearNode(workspaceBookingsList);
    clearNode(workspaceServicesList);
    clearNode(workspaceMessagesList);
    clearNode(workspaceNotificationsList);
    clearNode(workspaceMessageBooking);
    setCollectionEmptyState(workspaceSavedArtists, workspaceSavedEmpty, true, "No saved artists yet.");
    setCollectionEmptyState(workspaceBookingsList, workspaceBookingsEmpty, true, "No bookings yet.");
    setCollectionEmptyState(workspaceServicesList, workspaceServicesEmpty, true, "No services yet.");
    setCollectionEmptyState(workspaceMessagesList, workspaceMessagesEmpty, true, "No messages yet.");
    setCollectionEmptyState(workspaceNotificationsList, workspaceNotificationsEmpty, true, "No notifications yet.");
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

  const userBookings = db.bookings.filter((booking) => user && booking.userId === user.id);
  const artistBookings = db.bookings.filter((booking) => artist && booking.artistId === artist.id);
  writeText(statUserBookings, userBookings.length);
  writeText(statArtistBookings, artistBookings.length);

  const servicesCount = artist ? getServicesForArtist(db, artist.id).length : 0;
  writeText(statActiveServices, servicesCount);

  const unreadCount = db.notifications.filter(
    (notification) =>
      !notification.read &&
      ((user && notification.role === "user" && notification.ownerId === user.id) ||
        (artist && notification.role === "artist" && notification.ownerId === artist.id)),
  ).length;
  writeText(statUnreadUpdates, unreadCount);

  renderSavedArtists(context);
  renderBookings(context);
  renderServices(context);
  const messageBookings = Array.from(
    new Map([...userBookings, ...artistBookings].map((booking) => [booking.id, booking])).values(),
  );
  renderMessageOptions(context, messageBookings);
  renderMessages(context);
  renderNotifications(context);
}

function showView(nextView) {
  currentView = nextView;
  views.forEach((section) => {
    section.hidden = section.getAttribute("data-auth-view") !== nextView;
  });
}

function setSignedInControls(enabled) {
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
      ? "You are signed in. Your unified workspace is ready."
      : "Log in to continue.";
  }

  if (signedInEmail) {
    signedInEmail.textContent = signedIn ? session.cognitoEmail : "-";
  }

  renderLastLogin(session);

  if (currentModeLabel) {
    currentModeLabel.textContent = signedIn ? "Unified workspace access" : "Sign in required";
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

  const saved = Array.isArray(context.user.savedArtists) ? [...context.user.savedArtists] : [];
  if (!saved.length) {
    showToast("No saved artists found for this account.", "warning");
    return;
  }

  saved.forEach((artistId) => {
    toggleSaveArtist(context.user.id, artistId);
  });
  syncSessionFromExisting();
  showToast("Saved artists cleared.", "success");
});

workspaceRefreshBtn?.addEventListener("click", async () => {
  await hydrateDB();
  syncSessionFromExisting();
  showToast("Workspace refreshed.", "success");
});

workspaceServiceForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const context = signedInContext(ensureLinkedProfiles(getSession()));
  if (!context?.artist?.id) {
    showToast("Sign in to manage services.", "warning");
    return;
  }

  const serviceId = (workspaceServiceId?.value || "").trim();
  const title = (workspaceServiceTitle?.value || "").trim();
  const description = (workspaceServiceDescription?.value || "").trim();
  const price = Number(workspaceServicePrice?.value || 0);
  const deliveryDays = Number(workspaceServiceDelivery?.value || 0);

  const saved = upsertService(context.artist.id, {
    id: serviceId || undefined,
    title,
    description,
    price,
    deliveryDays,
  });

  if (!saved) {
    showToast("Enter title, description, price, and delivery days.", "warning");
    return;
  }

  resetServiceEditor();
  syncSessionFromExisting();
  showToast(serviceId ? "Service updated." : "Service created.", "success");
});

workspaceServiceReset?.addEventListener("click", () => {
  resetServiceEditor();
});

workspaceMessageForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const context = signedInContext(ensureLinkedProfiles(getSession()));
  if (!context) {
    showToast("Sign in to send a message.", "warning");
    return;
  }

  const bookingId = String(workspaceMessageBooking?.value || "").trim();
  const body = String(workspaceMessageBody?.value || "").trim();
  if (!bookingId || !body) {
    showToast("Select a booking thread and write a message.", "warning");
    return;
  }

  const booking = context.db.bookings.find((item) => item.id === bookingId);
  if (!booking) {
    showToast("Booking thread not found.", "warning");
    return;
  }

  let payload = null;
  if (context.user?.id && booking.userId === context.user.id) {
    payload = {
      threadId: `t-${booking.userId}-${booking.artistId}`,
      bookingId: booking.id,
      fromRole: "user",
      fromId: booking.userId,
      toRole: "artist",
      toId: booking.artistId,
      body,
    };
  } else if (context.artist?.id && booking.artistId === context.artist.id) {
    payload = {
      threadId: `t-${booking.userId}-${booking.artistId}`,
      bookingId: booking.id,
      fromRole: "artist",
      fromId: booking.artistId,
      toRole: "user",
      toId: booking.userId,
      body,
    };
  }

  if (!payload) {
    showToast("You do not have access to this booking thread.", "warning");
    return;
  }

  const created = sendMessage(payload);
  if (!created) {
    showToast("Message could not be sent.", "warning");
    return;
  }

  if (workspaceMessageBody instanceof HTMLTextAreaElement) {
    workspaceMessageBody.value = "";
  }
  syncSessionFromExisting();
  showToast("Message sent.", "success");
});

workspaceMarkNotificationsRead?.addEventListener("click", () => {
  const context = signedInContext(ensureLinkedProfiles(getSession()));
  if (!context) {
    showToast("Sign in to manage notifications.", "warning");
    return;
  }

  if (context.user?.id) {
    markNotificationsRead("user", context.user.id);
  }
  if (context.artist?.id) {
    markNotificationsRead("artist", context.artist.id);
  }

  syncSessionFromExisting();
  showToast("Notifications marked as read.", "success");
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
