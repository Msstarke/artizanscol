import { BOOKING_STATUSES, getArtistById, getDB, getServiceById, hydrateDB } from "../store.js";
import { requireRole } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, formatDate, statusBadge } from "../utils.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["user"]);
if (!session) throw new Error("Unauthorized");

const statusFilter = byId("history-status");
const table = byId("history-table");

if (statusFilter) {
  statusFilter.innerHTML += BOOKING_STATUSES.map((status) => `<option value="${status}">${status.replaceAll("_", " ")}</option>`).join("");
}

function render() {
  const db = getDB();
  const status = statusFilter?.value || "";

  let rows = db.bookings.filter((booking) => booking.userId === session.activeUserId);
  if (status) {
    rows = rows.filter((booking) => booking.status === status);
  }

  table.innerHTML = rows.length
    ? rows
        .map((booking) => {
          const artist = getArtistById(db, booking.artistId);
          const service = getServiceById(db, booking.serviceId);
          return `<tr>
            <td>${booking.id}</td>
            <td>${artist?.name || "Artist"}</td>
            <td>${service?.title || "Service"}</td>
            <td>${statusBadge(booking.status)}</td>
            <td>${formatDate(booking.updatedAt)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5"><div class="empty-state">No bookings found for this filter.</div></td></tr>`;
}

statusFilter?.addEventListener("change", render);
render();
