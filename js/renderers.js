import {
  formatMoney,
  escapeHtml,
  sanitizeClassToken,
  sanitizeImageUrl,
  statusBadge,
} from "./utils.js";

const FALLBACK_PORTFOLIO_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0' stop-color='%23f6efe4'/%3E%3Cstop offset='1' stop-color='%23e3d6c2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='600' height='400' fill='url(%23g)'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='32' font-family='sans-serif' fill='%235a4937'%3EPortfolio%3C/text%3E%3C/svg%3E";

export function artistCardHTML(artist, options = {}) {
  const previewHref = options.previewHref || `/artist-preview.html?id=${encodeURIComponent(String(artist.id || ""))}`;
  const verifiedLabel = artist.verified ? "Verified" : "Published";
  const actionButtons = options.actionButtons || "";
  const portfolio = Array.isArray(artist.portfolio) ? artist.portfolio : [];
  const imageSrc = sanitizeImageUrl(portfolio[0]?.image || portfolio[0]?.imageUrl, FALLBACK_PORTFOLIO_IMAGE);
  const availabilityLabel = artist.availability === "limited" ? "Limited availability" : "Open for briefs";
  const mediaSummary = Array.isArray(artist.mediums) && artist.mediums.length
    ? artist.mediums.slice(0, 2).join(" • ")
    : "Human-made creative work";
  const rawBio = String(artist.bio || "").trim();
  const bioSummary = rawBio.length > 8 && rawBio.toLowerCase() !== "bio" && rawBio.toLowerCase() !== "placeholder" ? rawBio : "";
  const reviewLabel = Number(artist.reviewCount || 0) > 0 ? `${artist.reviewCount} review${artist.reviewCount === 1 ? "" : "s"}` : null;
  const profileMomentum = Number(artist.popularity || 0) > 0 ? `${artist.popularity} interest` : null;
  const budgetLabel = Number(artist.priceFrom || 0) > 0 ? `Starts around ${formatMoney(artist.priceFrom)}` : "Budget on request";
  const profileAgeLabel = Number(artist.completedBookings || 0) > 0
    ? `${artist.completedBookings} completed booking${artist.completedBookings === 1 ? "" : "s"}`
    : "Ready for first booking";
  const locationLabel = String(artist.location || "").trim() || "Remote or flexible";
  const profileCopy = bioSummary || `${mediaSummary}. ${budgetLabel}.`;
  const ratingLabel =
    Number(artist.reviewCount || 0) > 0 && Number(artist.rating || 0) > 0
      ? `${Number(artist.rating || 0).toFixed(1)} ★`
      : "—";
  return `
    <article class="artist-card">
      <a class="artist-card-media" href="${escapeHtml(previewHref)}" aria-label="Open ${escapeHtml(artist.name)} profile">
        <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(artist.name)} preview" />
        <div class="artist-card-badges">
          <span class="artist-card-badge artist-card-badge-${artist.verified ? "verified" : "pending"}">${escapeHtml(verifiedLabel)}</span>
          <span class="artist-card-badge">${escapeHtml(availabilityLabel)}</span>
        </div>
      </a>
      <div class="artist-card-body">
        <div class="artist-card-heading">
          <div>
            <h3>${escapeHtml(artist.name)}</h3>
            <p class="artist-card-subtitle">${escapeHtml(artist.category || "Creative profile")} • ${escapeHtml(locationLabel)}</p>
          </div>
          <span class="artist-card-rating">${escapeHtml(ratingLabel)}</span>
        </div>
        <p class="artist-card-copy">${escapeHtml(profileCopy)}</p>
        <div class="tag-row">
          ${Array.isArray(artist.mediums)
            ? artist.mediums
                .slice(0, 3)
                .map((medium) => `<span class="tag">${escapeHtml(medium)}</span>`)
                .join("")
            : ""}
        </div>
        <div class="artist-card-metrics">
          <span>${escapeHtml(budgetLabel)}</span>
          ${reviewLabel ? `<span>${escapeHtml(reviewLabel)}</span>` : ""}
          ${profileMomentum ? `<span>${escapeHtml(profileMomentum)}</span>` : ""}
        </div>
        <div class="artist-card-support">
          <span>${escapeHtml(profileAgeLabel)}</span>
          <span>${escapeHtml(artist.handle ? `@${artist.handle}` : "Direct enquiries enabled")}</span>
        </div>
        <div class="artist-card-footer">
          <small class="muted">${escapeHtml(locationLabel)}</small>
          ${actionButtons}
        </div>
      </div>
    </article>
  `;
}

export function bookingActionButtons(booking, actions) {
  if (!actions?.length) {
    return "";
  }
  const buttons = actions
    .map((action) => {
      const classToken = sanitizeClassToken(action.className || "btn-outline", "btn-outline");
      const actionValue = escapeHtml(String(action.value || ""));
      const bookingId = escapeHtml(String(booking.id || ""));
      const label = escapeHtml(String(action.label || "Action"));
      return `<button class="btn ${classToken} btn-small" data-booking-action="${actionValue}" data-booking-id="${bookingId}" type="button">${label}</button>`;
    })
    .join(" ");
  return `<div class="form-actions">${buttons}</div>`;
}

export function notificationItemHTML(notification) {
  return `
    <li class="collection-item">
      <div class="page-title-row" style="margin-bottom:0.25rem;">
        <strong>${escapeHtml(notification.title)}</strong>
        ${statusBadge(notification.read ? "resolved" : "open")}
      </div>
      <p>${escapeHtml(notification.detail || "")}</p>
      <small class="muted">${new Date(notification.createdAt).toLocaleString("en-AU")}</small>
    </li>
  `;
}
