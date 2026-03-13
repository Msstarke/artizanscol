import {
  createBooking,
  ensureUserForCognito,
  getArtistById,
  getArtistPublishSummary,
  getDB,
  hydrateDB,
  isArtistProfileLive,
  getVisibleArtists,
  sendMessage,
  toggleSaveArtist,
} from "./store.js";
import { isCognitoAuthenticated } from "./cognito-auth.js";
import { getSession, setSession } from "./session.js";
import { assertCanMutate } from "./router-guards.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, escapeHtml, formatMoney, getQueryParam, showToast } from "./utils.js";
import { artistCardHTML } from "./renderers.js";

initSharedPage();
await hydrateDB();

let session = getSession();
let db = getDB();

const MAX_BOOKING_BUDGET = 1_000_000;
const MAX_BOOKING_MESSAGE_LENGTH = 2000;
const FALLBACK_PORTFOLIO_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='560' viewBox='0 0 800 560'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0' stop-color='%23f6efe4'/%3E%3Cstop offset='1' stop-color='%23dccab1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='560' fill='url(%23bg)'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='34' font-family='sans-serif' fill='%23614d3a'%3EPortfolio%20Preview%3C/text%3E%3C/svg%3E";

const artistIdFromQuery = getQueryParam("id");
const fallbackArtistId = session.activeArtistId || db.artists.find((item) => isArtistProfileLive(item))?.id || null;
const artistId = artistIdFromQuery || fallbackArtistId;
const artist = artistId ? getArtistById(db, artistId) : null;

const artistName = byId("artist-name");
const artistStatusLabel = byId("artist-status-label");
const artistBio = byId("artist-bio");
const artistTags = byId("artist-tags");
const artistMeta = byId("artist-meta");
const profileHeroMedia = byId("profile-hero-media");
const artistProofGrid = byId("artist-proof-grid");
const portfolioGrid = byId("portfolio-grid");
const servicesList = byId("services-list");
const reviewsList = byId("reviews-list");
const availabilityList = byId("availability-list");
const relatedProfiles = byId("related-profiles");
const saveArtistBtn = byId("save-artist-btn");
const contactArtistBtn = byId("contact-artist-btn");
const openBookingBtn = byId("open-booking-btn");
const bookingForm = byId("booking-form");
const bookingFocus = byId("booking-service");
const bookingDeadline = byId("booking-deadline");
const bookingBudget = byId("booking-budget");
const bookingMessage = byId("booking-message");
const prefillBooking = byId("prefill-booking");

function viewerOwnsArtistProfile() {
  return Boolean(artist && session.activeArtistId === artist.id && isCognitoAuthenticated());
}

function profileIsPublic() {
  return Boolean(artist && isArtistProfileLive(artist));
}

function profileIsAccessible() {
  return Boolean(artist) && (profileIsPublic() || viewerOwnsArtistProfile());
}

function viewerCanBookArtistProfile() {
  return Boolean(artist) && profileIsPublic() && !viewerOwnsArtistProfile();
}

function updateBookingCta() {
  if (!openBookingBtn) {
    return;
  }

  if (!artist) {
    openBookingBtn.textContent = "No artist available";
    openBookingBtn.disabled = true;
    return;
  }

  if (!profileIsPublic()) {
    openBookingBtn.textContent = viewerOwnsArtistProfile() ? "Profile is hidden" : "Booking unavailable";
    openBookingBtn.disabled = true;
    return;
  }

  if (viewerOwnsArtistProfile()) {
    openBookingBtn.textContent = "This is your profile";
    openBookingBtn.disabled = true;
    return;
  }

  openBookingBtn.textContent = isCognitoAuthenticated() ? "Start booking" : "Sign in to submit a brief";
  openBookingBtn.disabled = false;
}

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

function setBookingFormEnabled(enabled) {
  if (!bookingForm) {
    return;
  }

  bookingForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    if (field instanceof HTMLElement && "disabled" in field) {
      field.disabled = !enabled;
    }
  });
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

function renderUnavailableProfile(title, message) {
  if (artistStatusLabel) {
    artistStatusLabel.textContent = "Artist profile";
  }

  if (artistName) {
    artistName.textContent = title;
  }

  if (artistBio) {
    artistBio.textContent = message;
  }

  if (artistTags) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "Unavailable";
    artistTags.replaceChildren(tag);
  }

  if (artistMeta) {
    const text = document.createElement("span");
    text.textContent = "Open account settings to publish or update an artist profile.";
    artistMeta.replaceChildren(text);
  }

  if (profileHeroMedia) {
    profileHeroMedia.replaceChildren();
  }

  if (artistProofGrid) {
    artistProofGrid.replaceChildren();
  }

  setEmptyCollection(portfolioGrid, "Portfolio samples will appear here once the profile is live.");
  setEmptyCollection(servicesList, "Profile details are unavailable right now.", "li");
  setEmptyCollection(reviewsList, "No client reviews available.", "li");
  setEmptyCollection(availabilityList, "No availability published.", "li");

  [saveArtistBtn, contactArtistBtn, openBookingBtn].forEach((button) => {
    if (button) {
      button.disabled = true;
    }
  });

  setBookingFormEnabled(false);

  if (relatedProfiles) {
    setEmptyCollection(relatedProfiles, "More live profiles will appear here once artists publish them.");
  }
}

function renderArtistDetails() {
  if (!artist) {
    renderUnavailableProfile(
      "No artist selected",
      "No artist profile is currently available. Turn on an artist account from account settings to publish one.",
    );
    return;
  }

  if (!profileIsAccessible()) {
    const publishSummary = getArtistPublishSummary(artist);
    renderUnavailableProfile(
      viewerOwnsArtistProfile()
        ? publishSummary.publishState === "ready"
          ? "Profile ready to publish"
          : "Profile draft"
        : "Artist profile unavailable",
      viewerOwnsArtistProfile()
        ? publishSummary.publishState === "ready"
          ? "This profile is saved and ready. Use Show profile in account settings to make it visible in Explore and booking."
          : `Complete ${publishSummary.publishMissingFields.join(", ")} in account settings before this profile can go live.`
        : "This artist has turned their public profile off and is not currently available for discovery or booking.",
    );
    return;
  }

  document.title = `ARTIZANS.COLLECTIVE | ${artist.name}`;

  if (artistStatusLabel) {
    if (!profileIsPublic()) {
      artistStatusLabel.textContent = "Artist account off";
    } else {
      artistStatusLabel.textContent = artist.verified ? "Verified artist profile" : "Artist profile";
    }
  }

  if (artistName) {
    artistName.textContent = artist.name;
  }

  const bioText = String(artist.bio || "").trim();
  const safeBio = bioText.length > 8 && bioText.toLowerCase() !== "bio" && bioText.toLowerCase() !== "placeholder" ? bioText : "";

  if (artistBio) {
    artistBio.textContent = safeBio;
    artistBio.hidden = !safeBio;
  }

  if (artistTags) {
    artistTags.innerHTML = [
      artist.category,
      ...(artist.mediums || []),
      artist.verified ? "Verified" : profileIsPublic() ? "Live profile" : "Private profile",
    ]
      .filter(Boolean)
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
  }

  if (artistMeta) {
    artistMeta.innerHTML = [
      artist.location ? `Location: ${artist.location}` : null,
      Number(artist.priceFrom || 0) > 0 ? `Starting budgets from ${formatMoney(artist.priceFrom || 0)}` : "Budget shaped around the brief",
      Number(artist.reviewCount || 0) > 0 && Number(artist.rating || 0) > 0
        ? `Rating ${Number(artist.rating || 0).toFixed(1)}`
        : null,
      `Availability: ${artist.availability === "limited" ? "Limited" : "Open"}`,
      Number(artist.completedBookings || 0) > 0
        ? `${Number(artist.completedBookings || 0)} completed booking${Number(artist.completedBookings || 0) === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");
  }

  if (profileHeroMedia) {
    const leadImage = safeImageUrl(artist.portfolio?.[0]?.image || artist.portfolio?.[0]?.imageUrl);
    profileHeroMedia.innerHTML = `
      <article class="profile-media-card">
        <img src="${escapeHtml(leadImage)}" alt="${escapeHtml(artist.name)} portfolio highlight" />
        <div class="profile-media-card-copy">
          <p class="site-tag">Profile highlight</p>
          <h3>${escapeHtml(artist.portfolio?.[0]?.title || artist.category || "Published profile")}</h3>
          <p>${escapeHtml(safeBio || "Published profile with live availability, pricing signals, and direct booking access.")}</p>
        </div>
      </article>
    `;
  }

  if (artistProofGrid) {
    const proofItems = [
      {
        title: profileIsPublic() ? (artist.verified ? "Verified" : "Live") : "Hidden",
        label: "profile visibility",
      },
      {
        title: Number(artist.priceFrom || 0) > 0 ? formatMoney(artist.priceFrom || 0) : "Flexible",
        label: "starting budget",
      },
      Number(artist.reviewCount || 0) > 0
        ? {
            title: `${Number(artist.reviewCount || 0)}`,
            label: "client reviews",
          }
        : {
            title: artist.availability === "limited" ? "Limited" : "Open",
            label: "availability",
          },
      Number(artist.completedBookings || 0) > 0
        ? {
            title: `${Number(artist.completedBookings || 0)}`,
            label: "completed bookings",
          }
        : Number(artist.popularity || artist.profileViews || 0) > 0
          ? {
              title: `${Number(artist.popularity || artist.profileViews || 0)}`,
              label: "interest signals",
            }
          : {
              title: "New",
              label: "public profile",
            },
    ];

    artistProofGrid.innerHTML = proofItems
      .map(
        (item) => `
          <div class="profile-stat">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.label)}</span>
          </div>
        `,
      )
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
            <p>Portfolio sample from the artist's published body of work.</p>
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
    const focusItems = [
      {
        title: "What they do",
        detail: artist.category || "Creative practice",
      },
      {
        title: "Works across",
        detail: (artist.mediums || []).join(", ") || "Human-made creative work",
      },
      {
        title: "Starting budget",
        detail: Number(artist.priceFrom || 0) > 0 ? formatMoney(artist.priceFrom || 0) : "Discussed per brief",
      },
      {
        title: "Availability",
        detail: artist.availability === "limited" ? "Limited availability" : "Open for briefs",
      },
      {
        title: "Best fit for",
        detail: safeBio || "Clients looking for a clear creative practice and direct booking flow.",
      },
    ];

    servicesList.innerHTML = focusItems
      .map(
        (item) => `
          <li class="collection-item">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.detail)}</p>
          </li>
        `,
      )
      .join("");
  }

  if (reviewsList) {
    const reviewCount = Number(artist.reviewCount || 0);
    if (reviewCount > 0 && Number(artist.rating || 0) > 0) {
      const rendered = Math.min(reviewCount, 4);
      reviewsList.innerHTML = Array.from({ length: rendered })
        .map((_, index) => {
          const score = Number((artist.rating - index * 0.1).toFixed(1));
          return `<li class="collection-item"><h4>${score} / 5.0</h4><p>Reliable communication, clear brief handling, and professional follow-through.</p></li>`;
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
        return `<li class="collection-item">
          <strong>${escapeHtml(
            date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }),
          )}</strong>
          <p>${escapeHtml(index === 0 ? "Earliest likely start" : "Available project window")}</p>
        </li>`;
      })
      .join("");
  }

  if (relatedProfiles) {
    const items = getVisibleArtists(db)
      .filter((item) => item.id !== artist.id)
      .map((item) => {
        const sameCategory = item.category && artist.category && item.category === artist.category ? 3 : 0;
        const sharedMediums = (item.mediums || []).filter((medium) => (artist.mediums || []).includes(medium)).length;
        const availabilityBoost = item.availability === "open" ? 1 : 0;
        return {
          item,
          score: sameCategory + sharedMediums + availabilityBoost,
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return new Date(right.item.updatedAt || right.item.createdAt || 0).getTime() - new Date(left.item.updatedAt || left.item.createdAt || 0).getTime();
      })
      .map((entry) => entry.item)
      .slice(0, 3);

    relatedProfiles.classList.toggle("has-empty-state", !items.length);
    relatedProfiles.innerHTML = items.length
      ? items
          .map((item) =>
            artistCardHTML(item, {
              previewHref: `/artist-preview.html?id=${encodeURIComponent(String(item.id || ""))}`,
              actionButtons: `<div class="form-actions"><a class="btn btn-outline btn-small" href="/artist-preview.html?id=${encodeURIComponent(String(item.id || ""))}">View profile</a></div>`,
            }))
          .join("")
      : `
          <article class="empty-state empty-state-rich">
            <p class="site-tag">Keep exploring</p>
            <h3>No related live profiles yet.</h3>
            <p>Return to Explore to browse the wider live directory and compare profiles across categories and mediums.</p>
            <div class="form-actions">
              <a class="btn btn-outline btn-small" href="/explore.html">Open Explore</a>
            </div>
          </article>
        `;
  }

  if (saveArtistBtn) {
    saveArtistBtn.textContent = viewerOwnsArtistProfile() ? "Your profile" : "Save artist";
  }
  if (contactArtistBtn) {
    contactArtistBtn.textContent = viewerOwnsArtistProfile() ? "Own profile" : "Contact artist";
  }
  [saveArtistBtn, contactArtistBtn].forEach((button) => {
    if (button) {
      button.disabled = !viewerCanBookArtistProfile();
    }
  });
  setBookingFormEnabled(viewerCanBookArtistProfile());
}

saveArtistBtn?.addEventListener("click", async () => {
  if (!artist || !profileIsPublic()) {
    showToast("This artist profile is not available to save right now.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot save your own artist profile.", "warning");
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

  try {
    const saved = await toggleSaveArtist(userId, artist.id);
    showToast(saved ? "Artist saved to your list" : "Artist removed from saved list", "success");
    saveArtistBtn.textContent = saved ? "Saved" : "Save artist";
  } catch (error) {
    showToast(error?.message || "Could not update saved artists.", "danger");
  }
});

contactArtistBtn?.addEventListener("click", async () => {
  if (!artist || !profileIsPublic()) {
    showToast("This artist is not accepting public enquiries right now.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot message your own public profile from here.", "warning");
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

  try {
    await sendMessage({
      threadId: `t-${userId}-${artist.id}`,
      bookingId: null,
      fromRole: "user",
      fromId: userId,
      toRole: "artist",
      toId: artist.id,
      body: "Hi, I would like to discuss a potential project.",
    });

    showToast("Message sent to artist", "success");
    contactArtistBtn.textContent = "Message sent";
  } catch (error) {
    showToast(error?.message || "Message could not be sent.", "danger");
  }
});

openBookingBtn?.addEventListener("click", () => {
  if (!artist || !profileIsPublic()) {
    showToast("This artist profile is not currently open for booking.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot book your own artist profile.", "warning");
    return;
  }

  const userId = getActiveUserId();
  if (!userId) {
    redirectToAuth();
    return;
  }

  bookingForm?.scrollIntoView({ behavior: "smooth", block: "start" });
});

prefillBooking?.addEventListener("click", () => {
  if (!artist || !profileIsAccessible()) {
    showToast("No profile details are available to prefill.", "warning");
    return;
  }

  if (bookingFocus instanceof HTMLInputElement) {
    bookingFocus.value = artist.category || (artist.mediums || [])[0] || "Creative project";
  }

  if (bookingBudget) {
    bookingBudget.value = String(artist.priceFrom || 0);
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

bookingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!artist || !profileIsPublic()) {
    showToast("This artist profile is not currently available for booking.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot book your own artist profile.", "warning");
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

  const projectFocus = String(bookingFocus?.value || "").trim();
  const deadline = bookingDeadline?.value;
  const budget = Number(bookingBudget?.value || 0);
  const message = (bookingMessage?.value || "").trim();

  if (!projectFocus || !deadline || !budget || !message) {
    showToast("Project focus, deadline, budget, and message are required.", "warning");
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

  try {
    const booking = await createBooking({
      userId,
      artistId: artist.id,
      serviceLabel: projectFocus,
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
  } catch (error) {
    showToast(error?.message || "Booking could not be created.", "danger");
  }
});

updateBookingCta();
renderArtistDetails();
