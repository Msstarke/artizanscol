import {
  getArtistById,
  getDB,
  hydrateDB,
  getServiceById,
  sendMessage,
  updateBookingStatus,
} from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, formatDate, formatMoney, showToast, statusBadge } from "../utils.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["user"]);
if (!session) throw new Error("Unauthorized");

const messageArtist = byId("message-artist");
const messageBody = byId("message-body");
const messageList = byId("message-list");
const bookingTable = byId("booking-table");

function actionForStatus(status) {
  if (status === "accepted") return { next: "confirmed", label: "Confirm", className: "btn-success" };
  if (status === "confirmed") return { next: "paid", label: "Pay", className: "btn-primary" };
  if (status === "paid") return { next: "completed", label: "Complete", className: "btn-success" };
  if (["requested", "accepted", "confirmed", "payment_pending"].includes(status)) {
    return { next: "cancelled", label: "Cancel", className: "btn-danger" };
  }
  return null;
}

function render() {
  const db = getDB();
  const myBookings = db.bookings.filter((booking) => booking.userId === session.activeUserId);

  if (messageArtist) {
    const artistIds = [...new Set(myBookings.map((booking) => booking.artistId))];
    let artists = artistIds.map((id) => getArtistById(db, id)).filter(Boolean);
    if (!artists.length) {
      artists = [...db.artists];
    }
    messageArtist.innerHTML = artists.length
      ? artists.map((artist) => `<option value="${artist.id}">${artist.name}</option>`).join("")
      : `<option value="">No artists available</option>`;
  }

  const myMessages = db.messages
    .filter((message) => message.toId === session.activeUserId || message.fromId === session.activeUserId)
    .slice(-12)
    .reverse();

  messageList.innerHTML = myMessages.length
    ? myMessages
        .map((message) => {
          const counterpartArtistId =
            message.fromRole === "artist"
              ? message.fromId
              : message.toRole === "artist"
                ? message.toId
                : null;
          const artist = getArtistById(db, counterpartArtistId);
          return `<li class="collection-item"><h4>${artist?.name || "Artist"}</h4><p>${message.body}</p><small class="muted">${formatDate(message.createdAt)}</small></li>`;
        })
        .join("")
    : `<li class="empty-state">No messages yet.</li>`;

  bookingTable.innerHTML = myBookings.length
    ? myBookings
        .map((booking) => {
          const artist = getArtistById(db, booking.artistId);
          const service = getServiceById(db, booking.serviceId);
          const action = actionForStatus(booking.status);
          return `<tr>
            <td>${booking.id}<br /><small class="muted">${service?.title || "Service"}</small></td>
            <td>${artist?.name || "Artist"}<br /><small class="muted">${formatMoney(booking.budget)} • ${formatDate(booking.deadline)}</small></td>
            <td>${statusBadge(booking.status)}</td>
            <td>${
              action
                ? `<button class="btn ${action.className} btn-small" data-booking-id="${booking.id}" data-next-status="${action.next}" type="button">${action.label}</button>`
                : "-"
            }</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4"><div class="empty-state">No bookings yet.</div></td></tr>`;

  document.querySelectorAll("[data-next-status]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!assertCanMutate(session)) return;
      const bookingId = button.getAttribute("data-booking-id") || "";
      const next = button.getAttribute("data-next-status") || "";
      const result = updateBookingStatus(bookingId, next, "user");
      if (!result.ok) {
        showToast("Invalid booking transition", "warning");
        return;
      }
      showToast(`Booking ${bookingId} updated to ${next}`, "success");
      render();
    });
  });
}

byId("message-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  const artistId = messageArtist?.value;
  const body = (messageBody?.value || "").trim();
  if (!artistId || !body) {
    showToast("Artist and message are required", "warning");
    return;
  }

  sendMessage({
    threadId: `t-${session.activeUserId}-${artistId}`,
    bookingId: null,
    fromRole: "user",
    fromId: session.activeUserId,
    toRole: "artist",
    toId: artistId,
    body,
  });

  if (messageBody) messageBody.value = "";
  showToast("Message sent", "success");
  render();
});

render();
