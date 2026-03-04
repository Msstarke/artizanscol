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
import { byId, formatMoney, getQueryParam, showToast } from "./utils.js";

initSharedPage();

let session = getSession();
let db = getDB();

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
    artistTags.innerHTML = `<span class="tag">No profile</span>`;
  }

  if (artistMeta) {
    artistMeta.innerHTML = `<span>Create an artist account from Account Settings to get listed.</span>`;
  }

  if (portfolioGrid) {
    portfolioGrid.innerHTML = `<div class="empty-state">Portfolio is empty because no artist has onboarded yet.</div>`;
  }

  if (servicesList) {
    servicesList.innerHTML = `<li class="empty-state">No services available.</li>`;
  }

  if (reviewsList) {
    reviewsList.innerHTML = `<li class="empty-state">No reviews available.</li>`;
  }

  if (availabilityList) {
    availabilityList.innerHTML = `<li class="empty-state">No availability available.</li>`;
  }

  [saveArtistBtn, contactArtistBtn, openBookingBtn].forEach((button) => {
    if (button) {
      button.disabled = true;
    }
  });

  if (bookingForm) {
    bookingForm.innerHTML = `<div class="empty-state">No artist is available to book yet.</div>`;
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
      .map((tag) => `<span class="tag">${tag}</span>`)
      .join("");
  }

  if (artistMeta) {
    artistMeta.innerHTML = [
      `Location: ${artist.location || "Not set"}`,
      `From ${formatMoney(artist.priceFrom || 0)}`,
      `Rating ${artist.rating || 0}`,
      `Availability: ${artist.availability || "open"}`,
    ]
      .map((item) => `<span>${item}</span>`)
      .join("");
  }

  if (portfolioGrid) {
    if (artist.portfolio?.length) {
      portfolioGrid.innerHTML = artist.portfolio
        .map(
          (item) => `
        <article class="artist-card">
          <img src="${item.image}" alt="${item.title}" />
          <div class="artist-card-body">
            <h3>${item.title}</h3>
            <p>Human-created process evidence available.</p>
          </div>
        </article>
      `,
        )
        .join("");
    } else {
      portfolioGrid.innerHTML = `<div class="empty-state">No portfolio samples uploaded yet.</div>`;
    }
  }

  if (servicesList) {
    servicesList.innerHTML = services.length
      ? services
          .map(
            (service) => `
        <li class="collection-item">
          <h4>${service.title}</h4>
          <p>${service.description}</p>
          <p><strong>${formatMoney(service.price)}</strong> • ${service.deliveryDays} days</p>
        </li>
      `,
          )
          .join("")
      : `<li class="empty-state">No services listed yet.</li>`;
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
      reviewsList.innerHTML = `<li class="empty-state">No client reviews yet.</li>`;
    }
  }

  if (availabilityList) {
    availabilityList.innerHTML = Array.from({ length: 4 })
      .map((_, index) => {
        const date = new Date();
        date.setDate(date.getDate() + (index + 1) * 3);
        return `<li class="collection-item">${date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</li>`;
      })
      .join("");
  }

  if (bookingService) {
    bookingService.innerHTML = services.length
      ? services.map((service) => `<option value="${service.id}">${service.title} (${formatMoney(service.price)})</option>`).join("")
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
