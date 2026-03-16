import { initSharedPage } from "./shared-nav.js";
import { hydrateDB } from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { apiRequest } from "./api-client.js";
import { byId, escapeHtml, showToast } from "./utils.js";

initSharedPage();
await hydrateDB();

const loading = byId("admin-loading");
const shell = byId("admin-shell");
const denied = byId("admin-denied");

function showDenied() {
  loading.hidden = true;
  denied.hidden = false;
}

function showShell() {
  loading.hidden = true;
  shell.hidden = false;
}

if (!isCognitoAuthenticated()) {
  const next = encodeURIComponent(window.location.pathname);
  window.location.href = `/account-settings.html?next=${next}`;
} else {
  let system = null;

  try {
    const res = await apiRequest("/v1/admin/system");
    if (!res?.ok) throw Object.assign(new Error(res?.error?.message || "Failed"), { statusCode: 0 });
    system = res.data;
  } catch (err) {
    if (err?.statusCode === 403 || err?.statusCode === 401) {
      showDenied();
    } else {
      showShell();
      showToast("Failed to load system data. Some information may be unavailable.", "error");
    }
  }

  if (system) {
    showShell();

    // Metrics row
    const statsRoot = byId("admin-stats");
    if (statsRoot && system.metrics) {
      const m = system.metrics;
      const items = [
        { label: "Users", value: m.users },
        { label: "Artists", value: m.artists },
        { label: "Categories", value: m.categories },
        { label: "Open reports", value: m.reportsOpen },
        { label: "Error log", value: m.errorCount },
      ];
      statsRoot.innerHTML = items
        .map(
          (s) => `
          <div class="home-hero-stat">
            <strong>${escapeHtml(String(s.value))}</strong>
            <span>${escapeHtml(s.label)}</span>
          </div>
        `,
        )
        .join("");
    }

    // Maintenance toggle
    const maintenanceStatus = byId("maintenance-status");
    const maintenanceBtn = byId("maintenance-btn");
    const maintenanceNote = byId("maintenance-note");
    const maintenanceForm = byId("maintenance-form");

    let maintenanceEnabled = Boolean(system.maintenanceMode);

    function updateMaintenanceUI(enabled) {
      if (maintenanceStatus) {
        maintenanceStatus.textContent = enabled
          ? "Maintenance mode is ON. All mutating actions are blocked for users."
          : "Maintenance mode is OFF. Platform is fully operational.";
      }
      if (maintenanceBtn) {
        maintenanceBtn.textContent = enabled ? "Disable maintenance" : "Enable maintenance";
        maintenanceBtn.className = enabled ? "btn btn-primary" : "btn btn-outline";
        maintenanceBtn.disabled = false;
      }
    }

    updateMaintenanceUI(maintenanceEnabled);

    maintenanceForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = String(maintenanceNote?.value || "").trim();
      const next = !maintenanceEnabled;

      if (maintenanceBtn) {
        maintenanceBtn.disabled = true;
        maintenanceBtn.textContent = "Saving…";
      }

      try {
        const res = await apiRequest("/v1/admin/system/maintenance", {
          method: "PATCH",
          body: { maintenanceMode: next, ...(note ? { note } : {}) },
        });
        if (!res?.ok) throw new Error(res?.error?.message || "Failed to update maintenance mode.");
        maintenanceEnabled = next;
        updateMaintenanceUI(maintenanceEnabled);
        if (maintenanceNote) maintenanceNote.value = "";
        showToast(`Maintenance mode ${next ? "enabled" : "disabled"}.`, "success");
      } catch (err) {
        showToast(err?.message || "Failed to update maintenance mode.", "error");
        updateMaintenanceUI(maintenanceEnabled);
      }
    });
  }
}
