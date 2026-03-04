import { initSharedPage } from "./shared-nav.js";
import { byId, getQueryParam } from "./utils.js";

initSharedPage();

const message = byId("unauthorized-message");
const goAuth = byId("go-auth");

const required = (getQueryParam("required") || "").split(",").filter(Boolean);
const from = getQueryParam("from") || "/index.html";

if (message) {
  if (required.length) {
    message.textContent = `Required role: ${required.join(" or ")}. Current role does not have access.`;
  } else {
    message.textContent = "Your current role cannot access this route.";
  }
}

if (goAuth) {
  goAuth.href = `/account-settings.html?next=${encodeURIComponent(from)}`;
}
