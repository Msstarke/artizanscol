import { getArtistById, getDB, getUserById } from "./store.js";
import { getSession } from "./session.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";

export function redirectUnauthorized(requiredRoles = []) {
  const target = encodeURIComponent(window.location.pathname + window.location.search);
  const required = encodeURIComponent(requiredRoles.join(","));
  window.location.href = `/unauthorized.html?required=${required}&from=${target}`;
}

export function requireRole(requiredRoles = []) {
  const session = getSession();
  if (!requiredRoles.length) {
    return session;
  }

  if (!isCognitoAuthenticated()) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/account-settings.html?next=${next}`;
    return null;
  }

  if (!requiredRoles.includes(session.role)) {
    redirectUnauthorized(requiredRoles);
    return null;
  }

  const db = getDB();
  if (session.role === "user") {
    if (!session.activeUserId || !getUserById(db, session.activeUserId)) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/account-settings.html?next=${next}`;
      return null;
    }
  }

  if (session.role === "artist") {
    if (!session.activeArtistId || !getArtistById(db, session.activeArtistId)) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/account-settings.html?next=${next}`;
      return null;
    }
  }

  return session;
}

export function canMutate(session = getSession()) {
  const db = getDB();
  return !db.system.maintenanceMode;
}

export function assertCanMutate(session = getSession(), message) {
  const ok = canMutate(session);
  if (ok) {
    return true;
  }
  window.dispatchEvent(
    new CustomEvent("artizans:toast", {
      detail: {
        type: "warning",
        message:
          message ||
          "Maintenance mode is active. Mutating actions are temporarily disabled.",
      },
    }),
  );
  return false;
}
