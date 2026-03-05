import { getAWSConfig } from "./aws-config.js";
import { ensureCognitoSession, getCognitoAccessToken } from "./cognito-auth.js";

const DEFAULT_RETRIES = 1;

function joinUrl(base, path) {
  const normalizedBase = String(base || "").replace(/\/+$/, "");
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path)
    : `/${String(path || "")}`;

  if (!normalizedBase) {
    return normalizedPath;
  }

  return `${normalizedBase}${normalizedPath}`;
}

export function getApiBaseUrl() {
  const config = getAWSConfig();
  const fromConfig = String(config.ec2ApiBaseUrl || "").trim();
  const fromWindow = String(window.__ARTIZANS_API_BASE_URL || "").trim();
  const base = fromConfig || fromWindow;
  return base.replace(/\/+$/, "");
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

async function buildAuthHeaders(enabled) {
  if (!enabled) {
    return {};
  }

  await ensureCognitoSession();
  const token = getCognitoAccessToken();
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function apiRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    auth = true,
    retries = DEFAULT_RETRIES,
    headers = {},
  } = options;

  const url = joinUrl(getApiBaseUrl(), path);
  const authHeaders = await buildAuthHeaders(auth);

  const requestInit = {
    method,
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  };

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      const response = await fetch(url, requestInit);
      const payload = await readResponseBody(response);

      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.statusCode = response.status;
        error.payload = payload;
        throw error;
      }

      return payload;
    } catch (error) {
      lastError = error;

      const statusCode = Number(error?.statusCode || 0);
      const canRetryStatus = statusCode >= 500 || statusCode === 0;
      const canRetry = attempt < retries && canRetryStatus;

      if (!canRetry) {
        throw error;
      }

      const delayMs = 250 * (attempt + 1);
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }

  throw lastError || new Error("Request failed.");
}
