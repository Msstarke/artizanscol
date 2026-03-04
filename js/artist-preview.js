import {
  createBooking,
  ensureUserForCognito,
  getArtistById,
  getDB,
  getServiceById,
  getServicesForArtist,
  sendMessage,
  toggleSaveArtist,
} from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { getSession, setSession } from "./session.js";
import { assertCanMutate } from "./router-guards.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, escapeHtml, formatMoney, getQueryParam, showToast } from "./utils.js";

initSharedPage();

let session = getSession();
let db = getDB();

const MAX_BOOKING_BUDGET = 1_000_000;
const MAX_BOOKING_MESSAGE_LENGTH = 2000;
const FALLBACK_PORTFOLIO_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='560' viewBox='0 0 800 560'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0' stop-color='%23f6efe4'/%3E%3Cstop offset='1' stop-color='%23dccab1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='560' fill='url(%23bg)'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='34' font-family='sans-serif' fill='%23614d3a'%3EPortfolio%20Preview%3C/text%3E%3C/svg%3E";

const artistIdFromQuery = getQueryParam("id");
const fallbackArtistId = db.artists[0]?.id || null;
const artistId = artistIdFromQuery || fallbackArtistId;
const artist = artistId ? getArtistById(db, artistId) : null;

const artistName = byId("artist-name");
const artistBio = byId("artist-bio");
const artistTags = byId("artist-tags");
const artistMeta = byId("artist-meta");
const portfolioGrid = byId("portfolio-grid");
const servicesList = byId("services-list");
const reviewsList = byId("reviews-list");
const availabilityList = byId("availability-list");
const saveArtistBtn = byId("save-artist-btn");
const contactArtistBtn = byId("contact-artist-btn");
const openBookingBtn = byId("open-booking-btn");
const bookingForm = byId("booking-form");
const bookingService = byId("booking-service");
const bookingDeadline = byId("booking-deadline");
const bookingBudget = byId("booking-budget");
const bookingMessage = byId("booking-message");
const prefillBooking = byId("prefill-booking");

const services = artist ? getServicesForArtist(db, artist.id) : [];

function safeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return FALLBACK_PORTFOLIO_IMAGE;
  }

  if (raw.startsWith("data:image/")) {
    return raw;
  }

  try {
    const url = new URL(raw, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) {
      return FALLBACK_PORTFOLIO_IMAGE;
    }
    return url.href;
  } catch (_) {
    return FALLBACK_PORTFOLIO_IMAGE;
  }
}

function setEmptyCollection(root, message, listItemTag = "div") {
  if (!root) {
    return;
  }
  const node = document.createElement(listItemTag);
  node.className = "empty-state";
  node.textContent = message;
  root.replaceChildren(node);
}

function minBookingDateISO() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
}

if (bookingDeadline) {
  bookingDeadline.min = minBookingDateISO();
}

if (bookingMessage) {
  bookingMessage.maxLength = MAX_BOOKING_MESSAGE_LENGTH;
}

function getActiveUserId() {
  if (!isCognitoAuthenticated()) {
    return null;
  }

  if (!session.activeUserId) {
    const ensuredUser = ensureUserForCognito({
      sub: session.cognitoSub,
      email: session.cognitoEmail,
      username: session.cognitoUsername,
    });

    if (!ensuredUser) {
      return null;
    }

    session = setSession({
      ...session,
      role: "none",
      activeUserId: ensuredUser.id,
    });
  }

  return session.activeUserId;
}

function redirectToAuth(nextPath = window.location.pathname + window.location.search) {
  window.location.href = `/account-settings.html?next=${encodeURIComponent(nextPath)}`;
}

function renderNoArtistState() {
  if (artistName) {
    artistName.textContent = "No artist selected";
  }

  if (artistBio) {
    artistBio.textContent = "No artist profile is currently available. Sign in as an artist to publish a profile.";
  }

  if (artistTags) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "No profile";
    artistTags.replaceChildren(tag);
  }

  if (artistMeta) {
    const text = document.createElement("span");
    text.textContent = "Create an artist account from Account Settings to get listed.";
    artistMeta.replaceChildren(text);
  }

  setEmptyCollection(portfolioGrid, "Portfolio is empty because no artist has onboarded yet.");
  setEmptyCollection(servicesList, "No services available.", "li");
  setEmptyCollection(reviewsList, "No reviews available.", "li");
  setEmptyCollection(availabilityList, "No availability available.", "li");

  [saveArtistBtn, contactArtistBtn, openBookingBtn].forEach((button) => {
    if (button) {
      button.disabled = true;
    }
  });

  if (bookingForm) {
    setEmptyCollection(bookingForm, "No artist is available to book yet.");
  }
}

function renderArtistDetails() {
  if (!artist) {
    renderNoArtistState();
    return;
  }

  if (artistName) {
    artistName.textContent = artist.name;
  }

  if (artistBio) {
    artistBio.textContent = artist.bio;
  }

  if (artistTags) {
    artistTags.innerHTML = [artist.category, ...(artist.mediums || []), artist.verified ? "Verified" : "Pending"]
      .filter(Boolean)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
  }

  if (artistMeta) {
    artistMeta.innerHTML = [
      `Location: ${artist.location || "Not set"}`,
      `From ${formatMoney(artist.priceFrom || 0)}`,
      `Rating ${artist.rating || 0}`,
      `Availability: ${artist.availability || "open"}`,
    ]
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");
  }

  if (portfolioGrid) {
    if (artist.portfolio?.length) {
      portfolioGrid.innerHTML = artist.portfolio
        .map(
          (item) => `
        <article class="artist-card">
          <img src="${escapeHtml(safeImageUrl(item.image))}" alt="${escapeHtml(item.title)}" />
          <div class="artist-card-body">
            <h3>${escapeHtml(item.title)}</h3>
            <p>Human-created process evidence available.</p>
          </div>
        </article>
      `,
        )
        .join("");
    } else {
      setEmptyCollection(portfolioGrid, "No portfolio samples uploaded yet.");
    }
  }

  if (servicesList) {
    servicesList.innerHTML = services.length
      ? services
          .map(
            (service) => `
        <li class="collection-item">
          <h4>${escapeHtml(service.title)}</h4>
          <p>${escapeHtml(service.description)}</p>
          <p><strong>${formatMoney(service.price)}</strong> • ${service.deliveryDays} days</p>
        </li>
      `,
          )
          .join("")
      : `<li class="empty-state">${escapeHtml("No services listed yet.")}</li>`;
  }

  if (reviewsList) {
    const reviewCount = Number(artist.reviewCount || 0);
    if (reviewCount > 0 && Number(artist.rating || 0) > 0) {
      const rendered = Math.min(reviewCount, 4);
      reviewsList.innerHTML = Array.from({ length: rendered })
        .map((_, index) => {
          const score = Number((artist.rating - index * 0.1).toFixed(1));
          return `<li class="collection-item"><h4>${score} / 5.0</h4><p>Reliable communication and strong attention to brief details.</p></li>`;
        })
        .join("");
    } else {
      reviewsList.innerHTML = `<li class="empty-state">${escapeHtml("No client reviews yet.")}</li>`;
    }
  }

  if (availabilityList) {
    availabilityList.innerHTML = Array.from({ length: 4 })
      .map((_, index) => {
        const date = new Date();
        date.setDate(date.getDate() + (index + 1) * 3);
        return `<li class="collection-item">${escapeHtml(
          date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }),
        )}</li>`;
      })
      .join("");
  }

  if (bookingService) {
    bookingService.innerHTML = services.length
      ? services
          .map(
            (service) =>
              `<option value="${escapeHtml(service.id)}">${escapeHtml(service.title)} (${escapeHtml(formatMoney(service.price))})</option>`,
          )
          .join("")
      : `<option value="">No services available</option>`;
  }
}

saveArtistBtn?.addEventListener("click", () => {
  if (!artist) {
    return;
  }

  const userId = getActiveUserId();
  if (!userId) {
    redirectToAuth();
    return;
  }

  if (!assertCanMutate(session)) {
    return;
  }

  const saved = toggleSaveArtist(userId, artist.id);
  showToast(saved ? "Artist saved to your list" : "Artist removed from saved list", "success");
});

contactArtistBtn?.addEventListener("click", () => {
  if (!artist) {
    return;
  }

  const userId = getActiveUserId();
  if (!userId) {
    redirectToAuth();
    return;
  }

  if (!assertCanMutate(session)) {
    return;
  }

  sendMessage({
    threadId: `t-${userId}-${artist.id}`,
    bookingId: null,
    fromRole: "user",
    fromId: userId,
    toRole: "artist",
    toId: artist.id,
    body: "Hi, I would like to discuss a potential booking.",
  });

  showToast("Message sent to artist", "success");
});

openBookingBtn?.addEventListener("click", () => {
  if (!artist) {
    return;
  }

  if (!services.length) {
    showToast("This artist has not published services yet.", "warning");
    return;
  }

  bookingForm?.scrollIntoView({ behavior: "smooth", block: "start" });
});

prefillBooking?.addEventListener("click", () => {
  if (!artist || !services.length) {
    showToast("No services available to prefill.", "warning");
    return;
  }

  if (bookingBudget) {
    bookingBudget.value = String(services[0]?.price || artist.priceFrom || 0);
  }

  if (bookingMessage) {
    bookingMessage.value = "Need a verified human-made creative piece for a launch project. Delivery in one week.";
  }

  if (bookingDeadline) {
    const date = new Date();
    date.setDate(date.getDate() + 10);
    bookingDeadline.value = date.toISOString().slice(0, 10);
  }
});

bookingForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!artist) {
    showToast("No artist selected.", "warning");
    return;
  }

  const userId = getActiveUserId();
  if (!userId) {
    redirectToAuth();
    return;
  }

  if (!assertCanMutate(session)) {
    return;
  }

  if (!services.length) {
    showToast("This artist has no bookable services yet.", "warning");
    return;
  }

  const serviceId = bookingService?.value;
  const deadline = bookingDeadline?.value;
  const budget = Number(bookingBudget?.value || 0);
  const message = (bookingMessage?.value || "").trim();

  if (!serviceId || !deadline || !budget || !message) {
    showToast("Service, deadline, budget, and message are required.", "warning");
    return;
  }

  if (!Number.isFinite(budget) || budget < 1 || budget > MAX_BOOKING_BUDGET) {
    showToast(`Budget must be between 1 and ${MAX_BOOKING_BUDGET}.`, "warning");
    return;
  }

  const minDate = minBookingDateISO();
  if (deadline < minDate) {
    showToast("Deadline cannot be in the past.", "warning");
    return;
  }

  if (message.length > MAX_BOOKING_MESSAGE_LENGTH) {
    showToast(`Message must be ${MAX_BOOKING_MESSAGE_LENGTH} characters or fewer.`, "warning");
    return;
  }

  const service = getServiceById(db, serviceId);
  if (!service) {
    showToast("Invalid service selected.", "danger");
    return;
  }

  const booking = createBooking({
    userId,
    artistId: artist.id,
    serviceId,
    budget,
    deadline,
    message,
  });

  if (!booking) {
    showToast("Booking could not be created.", "danger");
    return;
  }

  db = getDB();
  showToast(`Booking ${booking.id} created.`, "success");
  bookingForm.reset();
});

renderArtistDetails();
