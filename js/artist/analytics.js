import { getArtistById, getDB } from "../store.js";
import { requireRole } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId } from "../utils.js";

initSharedPage();
const session = requireRole(["artist"]);
if (!session) throw new Error("Unauthorized");

const kpis = byId("analytics-kpis");
const table = byId("analytics-table");

function render() {
  const db = getDB();
  const artist = getArtistById(db, session.activeArtistId);
  if (!artist) return;

  const bookings = db.bookings.filter((booking) => booking.artistId === artist.id);
  const accepted = bookings.filter((booking) => ["accepted", "confirmed", "paid", "completed"].includes(booking.status)).length;
  const completed = bookings.filter((booking) => booking.status === "completed").length;
  const cancelled = bookings.filter((booking) => booking.status === "cancelled").length;

  const acceptanceRate = bookings.length ? Math.round((accepted / bookings.length) * 100) : 0;
  const completionRate = bookings.length ? Math.round((completed / bookings.length) * 100) : 0;

  kpis.innerHTML = `
    <article class="kpi"><small>Profile views</small><strong>${artist.profileViews}</strong></article>
    <article class="kpi"><small>Total bookings</small><strong>${bookings.length}</strong></article>
    <article class="kpi"><small>Acceptance rate</small><strong>${acceptanceRate}%</strong></article>
    <article class="kpi"><small>Completion rate</small><strong>${completionRate}%</strong></article>
  `;

  table.innerHTML = `
    <tr><td>Completed bookings</td><td>${completed}</td><td>Converted from paid and confirmed work.</td></tr>
    <tr><td>Cancelled bookings</td><td>${cancelled}</td><td>Useful for communication quality review.</td></tr>
    <tr><td>Current rating</td><td>${artist.rating}</td><td>Updates as verified reviews are added.</td></tr>
    <tr><td>Verified status</td><td>${artist.verified ? "Verified" : "Pending"}</td><td>Updated from platform verification flow.</td></tr>
  `;
}

render();
