import { getAWSConfig } from "./aws-config.js";

const COGNITO_SESSION_KEY = "artizans.cognito.v1";
const LEGACY_COGNITO_SESSION_KEY = "artizans.cognito.v1";

const FALLBACK_COGNITO_CONFIG = {
  region: "ap-southeast-2",
  userPoolId: "ap-southeast-2_SW8VfLv3l",
  userPoolClientId: "2lhd1i7taqjsk298dfsgigl1m2",
};

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function getStoredSession() {
  const sessionStorage = getSessionStorage();
  const localStorage = getLocalStorage();

  const fromSession = safeParse(sessionStorage?.getItem(COGNITO_SESSION_KEY) || "");
  if (fromSession) {
    return fromSession;
  }

  const legacy = safeParse(localStorage?.getItem(LEGACY_COGNITO_SESSION_KEY) || "");
  if (!legacy) {
    return null;
  }

  sessionStorage?.setItem(COGNITO_SESSION_KEY, JSON.stringify(legacy));
  localStorage?.removeItem(LEGACY_COGNITO_SESSION_KEY);
  return legacy;
}

function setStoredSession(session) {
  const payload = JSON.stringify(session);
  getSessionStorage()?.setItem(COGNITO_SESSION_KEY, payload);
  getLocalStorage()?.removeItem(LEGACY_COGNITO_SESSION_KEY);
}

function clearStoredSession() {
  getSessionStorage()?.removeItem(COGNITO_SESSION_KEY);
  getLocalStorage()?.removeItem(LEGACY_COGNITO_SESSION_KEY);
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(atob(payload));
  } catch (_) {
    return null;
  }
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function getCognitoConfig() {
  const awsConfig = getAWSConfig();
  return {
    region: awsConfig.region || FALLBACK_COGNITO_CONFIG.region,
    userPoolId: awsConfig.cognitoUserPoolId || FALLBACK_COGNITO_CONFIG.userPoolId,
    userPoolClientId: awsConfig.cognitoUserPoolClientId || FALLBACK_COGNITO_CONFIG.userPoolClientId,
  };
}

async function callCognito(target, payload) {
  const { region } = getCognitoConfig();
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const code = String(json?.__type || json?.code || json?.Code || "")
      .split("#")
      .pop()
      .trim();
    const message = json?.message || json?.Message || "Cognito request failed.";
    const error = new Error(message);
    error.code = code || null;
    throw error;
  }

  return json;
}

function isEnumerationSafeForgotPasswordError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return (
    code === "usernotfoundexception" ||
    message.includes("username/client id combination not found") ||
    message.includes("username or client id combination not found") ||
    message.includes("user does not exist")
  );
}

function identityFromIdToken(idToken) {
  const payload = decodeJwtPayload(idToken) || {};
  return {
    sub: payload.sub || null,
    email: payload.email || payload["cognito:username"] || null,
    username: payload["cognito:username"] || payload.email || null,
    exp: payload.exp || null,
  };
}

function normalizeSessionFromAuthResult(authResult) {
  const issuedAt = nowEpochSeconds();
  const expiresIn = Number(authResult?.ExpiresIn || 3600);
  const expiresAt = issuedAt + expiresIn;

  return {
    idToken: authResult?.IdToken || null,
    accessToken: authResult?.AccessToken || null,
    refreshToken: authResult?.RefreshToken || null,
    tokenType: authResult?.TokenType || "Bearer",
    issuedAt,
    expiresAt,
    identity: identityFromIdToken(authResult?.IdToken || ""),
  };
}

export function getCognitoIdentity() {
  const session = getStoredSession();
  if (!session?.idToken) {
    return null;
  }
  return session.identity || identityFromIdToken(session.idToken);
}

export function getCognitoAccessToken() {
  const session = getStoredSession();
  return session?.accessToken || null;
}

export function isCognitoAdmin() {
  try {
    const token = getCognitoAccessToken();
    if (!token) return false;
    const payload = JSON.parse(atob(token.split(".")[1]));
    const groups = String(payload["cognito:groups"] || "").replace(/^\[|]$/g, "");
    return groups.split(/[\s,]+/).includes("admin");
  } catch (_) {
    return false;
  }
}

export function isCognitoAuthenticated() {
  const session = getStoredSession();
  if (!session?.idToken || !session?.accessToken) {
    return false;
  }
  const exp = Number(session.expiresAt || 0);
  return Number.isFinite(exp) && exp > nowEpochSeconds() + 30;
}

export async function refreshCognitoSession() {
  const session = getStoredSession();
  if (!session?.refreshToken) {
    clearStoredSession();
    return null;
  }

  const { userPoolClientId } = getCognitoConfig();
  const response = await callCognito("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: userPoolClientId,
    AuthParameters: {
      REFRESH_TOKEN: session.refreshToken,
    },
  });

  const normalized = normalizeSessionFromAuthResult({
    ...response.AuthenticationResult,
    RefreshToken: session.refreshToken,
  });

  setStoredSession(normalized);
  return normalized.identity;
}

export async function ensureCognitoSession() {
  if (isCognitoAuthenticated()) {
    return getCognitoIdentity();
  }

  try {
    return await refreshCognitoSession();
  } catch (_) {
    clearStoredSession();
    return null;
  }
}

export async function signInCognito({ email, password }) {
  const { userPoolClientId } = getCognitoConfig();
  const response = await callCognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: userPoolClientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  if (response.ChallengeName) {
    throw new Error(`Unsupported auth challenge: ${response.ChallengeName}`);
  }

  const normalized = normalizeSessionFromAuthResult(response.AuthenticationResult || {});
  setStoredSession(normalized);
  return normalized.identity;
}

export async function signUpCognito({ email, password }) {
  const { userPoolClientId } = getCognitoConfig();
  return callCognito("SignUp", {
    ClientId: userPoolClientId,
    Username: email,
    Password: password,
    UserAttributes: [
      {
        Name: "email",
        Value: email,
      },
    ],
  });
}

export async function confirmSignUpCognito({ email, code }) {
  const { userPoolClientId } = getCognitoConfig();
  return callCognito("ConfirmSignUp", {
    ClientId: userPoolClientId,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function forgotPasswordCognito({ email }) {
  const { userPoolClientId } = getCognitoConfig();
  try {
    return await callCognito("ForgotPassword", {
      ClientId: userPoolClientId,
      Username: email,
    });
  } catch (error) {
    if (isEnumerationSafeForgotPasswordError(error)) {
      return { CodeDeliveryDetails: null };
    }
    throw error;
  }
}

export async function confirmForgotPasswordCognito({ email, code, newPassword }) {
  const { userPoolClientId } = getCognitoConfig();
  return callCognito("ConfirmForgotPassword", {
    ClientId: userPoolClientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  });
}

export async function signOutCognito() {
  clearStoredSession();
}
