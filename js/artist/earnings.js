import { getDB } from "../store.js";
import { requireRole } from "../router-guards.js";
import { initSharedPage } from "../shared-nav.js";
import { byId, formatDate, formatMoney, statusBadge } from "../utils.js";

initSharedPage();
const session = requireRole(["artist"]);
if (!session) throw new Error("Unauthorized");

const payoutKpis = byId("payout-kpis");
const payoutList = byId("payout-list");
const invoiceList = byId("invoice-list");

function render() {
  const db = getDB();
  const payouts = db.payouts.filter((payout) => payout.artistId === session.activeArtistId);
  const invoices = db.invoices.filter((invoice) => invoice.artistId === session.activeArtistId);

  const totalPayout = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const paidCount = payouts.filter((payout) => payout.status === "paid").length;

  if (payoutKpis) {
    payoutKpis.innerHTML = `
      <article class="kpi"><small>Total payout value</small><strong>${formatMoney(totalPayout)}</strong></article>
      <article class="kpi"><small>Total invoiced</small><strong>${formatMoney(totalInvoiced)}</strong></article>
      <article class="kpi"><small>Payout records</small><strong>${payouts.length}</strong></article>
      <article class="kpi"><small>Paid payouts</small><strong>${paidCount}</strong></article>
    `;
  }

  payoutList.innerHTML = payouts.length
    ? payouts
        .map(
          (payout) =>
            `<li class="collection-item"><h4>${formatMoney(payout.amount)}</h4><p>${statusBadge(payout.status)} • ${formatDate(payout.date)}</p></li>`,
        )
        .join("")
    : `<li class="empty-state">No payouts yet.</li>`;

  invoiceList.innerHTML = invoices.length
    ? invoices
        .map(
          (invoice) =>
            `<li class="collection-item"><h4>${invoice.id}</h4><p>${formatMoney(invoice.amount)} • ${statusBadge(invoice.status)}</p><small class="muted">${formatDate(invoice.createdAt)}</small></li>`,
        )
        .join("")
    : `<li class="empty-state">No invoices yet.</li>`;
}

render();
