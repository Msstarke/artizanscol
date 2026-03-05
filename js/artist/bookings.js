import { getDB, getUserById, hydrateDB, updateBookingStatus } from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, formatDate, statusBadge, showToast } from "../utils.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["artist"]);
if (!session) throw new Error("Unauthorized");

const table = byId("artist-booking-table");

function actionsForStatus(status) {
  if (status === "requested") {
    return [
      { next: "accepted", label: "Accept", className: "btn-success" },
      { next: "declined", label: "Decline", className: "btn-danger" },
    ];
  }

  if (status === "accepted") {
    return [{ next: "confirmed", label: "Confirm", className: "btn-primary" }];
  }

  if (["requested", "accepted", "confirmed", "payment_pending", "paid"].includes(status)) {
    return [{ next: "cancelled", label: "Cancel", className: "btn-danger" }];
  }

  return [];
}

function render() {
  const db = getDB();
  const bookings = db.bookings.filter((booking) => booking.artistId === session.activeArtistId);

  table.innerHTML = bookings.length
    ? bookings
        .map((booking) => {
          const user = getUserById(db, booking.userId);
          const actions = actionsForStatus(booking.status)
            .map(
              (action) =>
                `<button class="btn ${action.className} btn-small" data-booking-id="${booking.id}" data-next="${action.next}" type="button">${action.label}</button>`,
            )
            .join(" ");

          return `<tr>
            <td>${booking.id}<br /><small class="muted">${formatDate(booking.createdAt)}</small></td>
            <td>${user?.name || "User"}</td>
            <td>${statusBadge(booking.status)}</td>
            <td>${actions || "-"}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4"><div class="empty-state">No bookings found.</div></td></tr>`;

  document.querySelectorAll("[data-next]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!assertCanMutate(session)) return;
      const bookingId = button.getAttribute("data-booking-id") || "";
      const next = button.getAttribute("data-next") || "";
      const result = updateBookingStatus(bookingId, next, "artist");
      if (!result.ok) {
        showToast("Invalid transition", "warning");
        return;
      }
      showToast(`Booking ${bookingId} updated to ${next}`, "success");
      render();
    });
  });
}

render();
