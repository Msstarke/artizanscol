import { initSharedPage } from "./shared-nav.js";
import { byId, getQueryParam } from "./utils.js";

initSharedPage();

const message = byId("unauthorized-message");
const goAuth = byId("go-auth");

const required = (getQueryParam("required") || "").split(",").filter(Boolean);
const from = getQueryParam("from") || "/index.html";

if (message) {
  message.textContent = required.length
    ? "This role-based route moved to the unified workspace."
    : "This route moved to the unified workspace.";
}

if (goAuth) {
  goAuth.href = `/account-settings.html?next=${encodeURIComponent(from)}`;
}
