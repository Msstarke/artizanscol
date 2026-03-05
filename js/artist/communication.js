import { getDB, getUserById, hydrateDB, sendMessage } from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, showToast } from "../utils.js";
import { notificationItemHTML } from "../renderers.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["artist"]);
if (!session) throw new Error("Unauthorized");

const userSelect = byId("artist-message-user");
const messageBody = byId("artist-message-body");
const notificationList = byId("artist-notification-list");

function render() {
  const db = getDB();

  let relatedUsers = [...new Set(db.bookings.filter((booking) => booking.artistId === session.activeArtistId).map((booking) => booking.userId))]
    .map((userId) => getUserById(db, userId))
    .filter(Boolean);

  if (!relatedUsers.length) {
    relatedUsers = [...db.users];
  }

  if (userSelect) {
    userSelect.innerHTML = relatedUsers.length
      ? relatedUsers.map((user) => `<option value="${user.id}">${user.name}</option>`).join("")
      : "<option value=''>No users yet</option>";
  }

  const notifications = db.notifications
    .filter((notification) => notification.role === "artist" && notification.ownerId === session.activeArtistId)
    .slice(0, 10);

  notificationList.innerHTML = notifications.length
    ? notifications.map((notification) => notificationItemHTML(notification)).join("")
    : `<li class="empty-state">No notifications found.</li>`;
}

byId("artist-message-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!assertCanMutate(session)) return;

  const userId = userSelect?.value;
  const body = (messageBody?.value || "").trim();
  if (!userId || !body) {
    showToast("User and message are required", "warning");
    return;
  }

  sendMessage({
    threadId: `t-${userId}-${session.activeArtistId}`,
    bookingId: null,
    fromRole: "artist",
    fromId: session.activeArtistId,
    toRole: "user",
    toId: userId,
    body,
  });
  if (messageBody) messageBody.value = "";
  showToast("Message sent", "success");
  render();
});

render();
