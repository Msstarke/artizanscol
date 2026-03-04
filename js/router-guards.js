import {
  ensureArtistForCognito,
  ensureUserForCognito,
  getArtistById,
  getDB,
  getUserById,
} from "./store.js";
import { getSession, setSession } from "./session.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";

export function redirectUnauthorized(requiredRoles = []) {
  const target = encodeURIComponent(window.location.pathname + window.location.search);
  const required = encodeURIComponent(requiredRoles.join(","));
  window.location.href = `/unauthorized.html?required=${required}&from=${target}`;
}

export function requireRole(requiredRoles = []) {
  let session = getSession();
  if (!isCognitoAuthenticated()) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/account-settings.html?next=${next}`;
    return null;
  }

  if (!requiredRoles.length) {
    return session;
  }

  const db = getDB();
  const normalized = {
    sub: session.cognitoSub,
    email: session.cognitoEmail,
    username: session.cognitoUsername,
  };
  let sessionChanged = false;

  if (requiredRoles.includes("user")) {
    let user = session.activeUserId ? getUserById(db, session.activeUserId) : null;
    if (!user) {
      user = ensureUserForCognito(normalized);
      if (!user) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/account-settings.html?next=${next}`;
        return null;
      }
      session.activeUserId = user.id;
      sessionChanged = true;
    }
  }

  if (requiredRoles.includes("artist")) {
    let artist = session.activeArtistId ? getArtistById(db, session.activeArtistId) : null;
    if (!artist) {
      artist = ensureArtistForCognito(normalized);
      if (!artist) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/account-settings.html?next=${next}`;
        return null;
      }
      session.activeArtistId = artist.id;
      sessionChanged = true;
    }
  }

  if (sessionChanged) {
    session = setSession({
      ...session,
      role: "none",
    });
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
