import { ensureCognitoSession, getCognitoAccessToken } from "./cognito-auth.js";

const DEFAULT_RETRIES = 1;
const STATIC_API_BASE_URL = "__ARTIZANS_API_BASE_URL__";
const API_BASE_META_NAME = "artizans-api-base-url";

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
  if (typeof window !== "undefined") {
    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(window.location.hostname || "").toLowerCase();
    const isLocalDev =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".local");

    if ((protocol === "https:" || protocol === "http:") && !isLocalDev) {
      return "";
    }
  }

  const metaValue =
    document.querySelector(`meta[name="${API_BASE_META_NAME}"]`)?.getAttribute("content") || "";
  const injectedBase = STATIC_API_BASE_URL.includes("__ARTIZANS_API_BASE_URL__")
    ? ""
    : STATIC_API_BASE_URL;
  const base = String(metaValue || injectedBase || "").trim();
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

function isApiRequest(urlOrPath) {
  return /(^|\/)v1(\/|$)/.test(String(urlOrPath || ""));
}

function buildApiResponseError(message, statusCode = 0, payload = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload;
  return error;
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
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const expectsApiEnvelope = isApiRequest(url);

      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        throw buildApiResponseError(message, response.status, payload);
      }

      if (expectsApiEnvelope) {
        if (!contentType.includes("application/json")) {
          throw buildApiResponseError(
            "API returned a non-JSON response. The backend route is likely not deployed correctly.",
            response.status,
            payload,
          );
        }

        if (!payload || typeof payload !== "object" || typeof payload.ok !== "boolean") {
          throw buildApiResponseError(
            "API returned an invalid response shape. The backend route is likely misconfigured.",
            response.status,
            payload,
          );
        }
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
