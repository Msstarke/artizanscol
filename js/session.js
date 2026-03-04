export const SESSION_KEY = "artizans.session.v1";
const ALLOWED_ROLES = ["none", "user", "artist"];

const DEFAULT_SESSION = {
  role: "none",
  activeUserId: null,
  activeArtistId: null,
  cognitoEmail: null,
  cognitoSub: null,
  cognitoUsername: null,
  lastLoginAt: null,
};

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

export function getSession() {
  const parsed = safeParse(localStorage.getItem(SESSION_KEY));
  if (!parsed || typeof parsed.role !== "string" || !ALLOWED_ROLES.includes(parsed.role)) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(DEFAULT_SESSION));
    return { ...DEFAULT_SESSION };
  }
  return {
    ...DEFAULT_SESSION,
    ...parsed,
  };
}

export function setSession(nextSession) {
  const merged = {
    ...DEFAULT_SESSION,
    ...nextSession,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
  return merged;
}

export function loginAsRole(role, options = {}) {
  const normalizedRole = ALLOWED_ROLES.includes(role) ? role : "none";
  const existing = getSession();

  return setSession({
    role: normalizedRole,
    activeUserId: normalizedRole === "user" ? options.activeUserId || null : null,
    activeArtistId: normalizedRole === "artist" ? options.activeArtistId || null : null,
    cognitoEmail: options.cognitoEmail ?? existing.cognitoEmail ?? null,
    cognitoSub: options.cognitoSub ?? existing.cognitoSub ?? null,
    cognitoUsername: options.cognitoUsername ?? existing.cognitoUsername ?? null,
    lastLoginAt: new Date().toISOString(),
  });
}

export function logout() {
  return setSession(DEFAULT_SESSION);
}

export function isAuthenticatedRole(role) {
  return ["user", "artist"].includes(role);
}

export function getRoleHome(role) {
  if (role === "user") {
    return "/user/discovery.html";
  }
  if (role === "artist") {
    return "/artist/bookings.html";
  }
  return "/account-settings.html";
}

export function setCognitoIdentity(identity) {
  const existing = getSession();
  return setSession({
    ...existing,
    cognitoEmail: identity?.email || null,
    cognitoSub: identity?.sub || null,
    cognitoUsername: identity?.username || null,
  });
}

export function clearCognitoIdentity() {
  const existing = getSession();
  return setSession({
    ...existing,
    role: "none",
    activeUserId: null,
    activeArtistId: null,
    cognitoEmail: null,
    cognitoSub: null,
    cognitoUsername: null,
  });
}
