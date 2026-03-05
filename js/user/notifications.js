import { getDB, hydrateDB, markNotificationsRead } from "../store.js";
import { requireRole, assertCanMutate } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, showToast } from "../utils.js";
import { notificationItemHTML } from "../renderers.js";

initSharedPage();
await hydrateDB();
const session = requireRole(["user"]);
if (!session) throw new Error("Unauthorized");

const list = byId("notification-list");

function render() {
  const db = getDB();
  const notifications = db.notifications.filter(
    (notification) => notification.role === "user" && notification.ownerId === session.activeUserId,
  );

  list.innerHTML = notifications.length
    ? notifications.map((notification) => notificationItemHTML(notification)).join("")
    : `<li class="empty-state">No notifications yet.</li>`;
}

byId("mark-read-btn")?.addEventListener("click", () => {
  if (!assertCanMutate(session)) return;
  markNotificationsRead("user", session.activeUserId);
  showToast("All notifications marked as read", "success");
  render();
});

render();
