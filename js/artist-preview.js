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
import { apiRequest } from "./api-client.js";

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
const availabilityList = byId("availability-list");
const relatedProfiles = byId("related-profiles");
const saveArtistBtn = byId("save-artist-btn");
const contactArtistBtn = byId("contact-artist-btn");
const openBookingBtn = byId("open-booking-btn");
const ownerEditBtn = byId("owner-edit-btn");
const bookingForm = byId("booking-form");
const bookingFocus = byId("booking-service");
const bookingDeadline = byId("booking-deadline");
const bookingBudget = byId("booking-budget");
const bookingMessage = byId("booking-message");
const bookingMessageCounter = byId("booking-message-counter");
const prefillBooking = byId("prefill-booking");
const contactFormInline = byId("contact-form-inline");
const contactMessageBody = byId("contact-message-body");
const contactMessageCounter = byId("contact-message-counter");
const contactSendBtn = byId("contact-send-btn");
const contactCancelBtn = byId("contact-cancel-btn");

function initCharCounter(textarea, counter, maxLength) {
  if (!textarea || !counter) return;
  const update = () => { counter.textContent = `${textarea.value.length} / ${maxLength}`; };
  textarea.addEventListener("input", update);
  update();
}

initCharCounter(bookingMessage, bookingMessageCounter, 2000);
initCharCounter(contactMessageBody, contactMessageCounter, 2000);

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
    openBookingBtn.hidden = true;
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
    artistStatusLabel.textContent = "Creator studio";
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
    text.textContent = "Open account settings to publish or update your creator studio.";
    artistMeta.replaceChildren(text);
  }

  if (profileHeroMedia) {
    profileHeroMedia.replaceChildren();
  }

  if (artistProofGrid) {
    artistProofGrid.replaceChildren();
  }

  setEmptyCollection(portfolioGrid, "Portfolio samples will appear here once the profile is live.");
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
      "No creator studio is currently available. Turn on a studio from account settings to publish one.",
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
        : "Creator studio unavailable",
      viewerOwnsArtistProfile()
        ? publishSummary.publishState === "ready"
          ? "This profile is saved and ready. Use Show profile in account settings to make it visible in Explore and booking."
          : `Complete ${publishSummary.publishMissingFields.join(", ")} in account settings before this profile can go live.`
        : "This artist has turned their public profile off and is not currently available for discovery or booking.",
    );
    return;
  }

  if (artistStatusLabel) {
    if (!profileIsPublic()) {
      artistStatusLabel.textContent = "Artist account off";
    } else {
      artistStatusLabel.textContent = artist.verified ? "Verified creator studio" : "Creator studio";
    }
  }

  if (artistName) {
    artistName.textContent = artist.name;
  }

  if (artist.name) {
    document.title = `ARTIZANS.COLLECTIVE | ${artist.name}`;
  }

  const canonicalEl = document.querySelector('link[rel="canonical"]');
  if (canonicalEl && artist.id) {
    canonicalEl.href = `https://www.artizanscollective.com/artist-preview.html?id=${encodeURIComponent(artist.id)}`;
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
      artist.location ? `Location: ${escapeHtml(artist.location)}` : null,
      Number(artist.priceFrom || 0) > 0 ? `Starting budgets from ${formatMoney(artist.priceFrom || 0)}` : "Budget shaped around the brief",
      Number(artist.reviewCount || 0) > 0 && Number(artist.rating || 0) > 0
        ? `Rating ${Number(artist.rating || 0).toFixed(1)}`
        : null,
      artist.availability === "open" || artist.availability === "limited"
        ? `Availability: ${artist.availability === "limited" ? "Limited" : "Open"}`
        : null,
      Number(artist.completedBookings || 0) > 0
        ? `${Number(artist.completedBookings || 0)} completed booking${Number(artist.completedBookings || 0) === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");
  }

  if (profileHeroMedia) {
    const leadPortfolio = artist.portfolio?.[0];
    const leadImageRaw = leadPortfolio?.image || leadPortfolio?.imageUrl || "";
    if (leadImageRaw) {
      const leadImage = safeImageUrl(leadImageRaw);
      profileHeroMedia.innerHTML = `
        <article class="profile-media-card">
          <img src="${escapeHtml(leadImage)}" alt="${escapeHtml(artist.name)} portfolio highlight" />
          <div class="profile-media-card-copy">
            <p class="site-tag">Profile highlight</p>
            <h3>${escapeHtml(leadPortfolio?.title || artist.category || "Published profile")}</h3>
            <p>${escapeHtml(safeBio || "Published profile with live availability, pricing signals, and direct booking access.")}</p>
          </div>
        </article>
      `;
    } else {
      profileHeroMedia.hidden = true;
    }
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
          (item) => {
            const imgSrc = safeImageUrl(item.image || item.imageUrl);
            const title = String(item.title || "").trim();
            const desc = String(item.description || "").trim();
            return `
              <article class="portfolio-item">
                <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title || "Portfolio sample")}" loading="lazy" decoding="async" />
                ${title || desc ? `
                <div class="portfolio-item-caption">
                  ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
                  ${desc ? `<p>${escapeHtml(desc)}</p>` : ""}
                </div>` : ""}
              </article>
            `;
          },
        )
        .join("");
    } else {
      setEmptyCollection(portfolioGrid, "No portfolio samples added yet. Check back after the artist updates their profile.");
    }
  }

  if (availabilityList) {
    const isLimited = artist.availability === "limited";
    const budget = Number(artist.priceFrom || 0);
    const signals = [
      {
        label: "Availability",
        value: isLimited ? "Limited — reach out early" : "Open for new briefs",
      },
      {
        label: "Starting budget",
        value: budget > 0 ? `From ${formatMoney(budget)}` : "Discussed per brief",
      },
      {
        label: "Response",
        value: "Artist reviews requests and confirms fit before starting",
      },
    ];
    availabilityList.innerHTML = signals
      .map(
        (s) => `
          <li class="collection-item">
            <strong>${escapeHtml(s.label)}</strong>
            <p>${escapeHtml(s.value)}</p>
          </li>
        `,
      )
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

    const categoryParam = artist.category ? `?category=${encodeURIComponent(artist.category)}` : "";
    relatedProfiles.classList.toggle("has-empty-state", !items.length);
    relatedProfiles.innerHTML = items.length
      ? items
          .map((item) =>
            artistCardHTML(item, {
              previewHref: `/artist-preview.html?id=${encodeURIComponent(String(item.id || ""))}`,
              actionButtons: `<div class="form-actions"><a class="btn btn-outline btn-small" href="/artist-preview.html?id=${encodeURIComponent(String(item.id || ""))}">View profile</a></div>`,
            }))
          .join("") +
          `<div class="form-actions" style="margin-top:1rem"><a class="btn btn-outline btn-small" href="/explore.html${escapeHtml(categoryParam)}">View more in ${escapeHtml(artist.category || "Explore")}</a></div>`
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

  if (viewerOwnsArtistProfile()) {
    if (saveArtistBtn) saveArtistBtn.hidden = true;
    if (contactArtistBtn) contactArtistBtn.hidden = true;
    if (ownerEditBtn) {
      ownerEditBtn.hidden = false;
      ownerEditBtn.href = "/account-settings.html?section=profile";
    }
    setBookingFormEnabled(false);
    return;
  }

  if (ownerEditBtn) ownerEditBtn.hidden = true;

  if (saveArtistBtn) {
    saveArtistBtn.hidden = false;
    const userId = getActiveUserId();
    const user = userId ? db.users.find((u) => u.id === userId) : null;
    const alreadySaved = Boolean(user?.savedArtistIds?.includes(artist?.id));
    saveArtistBtn.textContent = alreadySaved ? "Saved" : "Save artist";
  }
  if (contactArtistBtn) {
    contactArtistBtn.hidden = false;
    contactArtistBtn.textContent = "Contact artist";
  }
  // Disable save/contact only if the profile itself is unavailable or the viewer owns it.
  // Unauthenticated visitors are allowed to click — the handlers redirect to sign-in.
  const profileUnavailable = !Boolean(artist) || !profileIsPublic() || viewerOwnsArtistProfile();
  [saveArtistBtn, contactArtistBtn].forEach((button) => {
    if (button) button.disabled = profileUnavailable;
  });
  setBookingFormEnabled(viewerCanBookArtistProfile());

  if (!isCognitoAuthenticated() && bookingForm) {
    const submitBtn = bookingForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in to send a brief";
      submitBtn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          redirectToAuth();
        },
        { once: true },
      );
    }
  }
}

saveArtistBtn?.addEventListener("click", async () => {
  if (!artist || !profileIsPublic()) {
    showToast("This creator studio is not available to save right now.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot save your own studio.", "warning");
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

contactArtistBtn?.addEventListener("click", () => {
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

  if (contactFormInline) {
    contactFormInline.hidden = !contactFormInline.hidden;
    if (!contactFormInline.hidden && contactMessageBody) {
      contactMessageBody.focus();
    }
  }
});

contactSendBtn?.addEventListener("click", async () => {
  const userId = getActiveUserId();
  if (!userId || !artist) return;

  if (!assertCanMutate(session)) return;

  const body = (contactMessageBody?.value || "").trim();
  if (!body) {
    showToast("Write a message before sending.", "warning");
    return;
  }

  contactSendBtn.disabled = true;
  contactSendBtn.textContent = "Sending…";

  try {
    await sendMessage({
      threadId: `t_${userId}_${artist.id}`,
      bookingId: null,
      fromRole: "user",
      fromId: userId,
      toRole: "artist",
      toId: artist.id,
      body,
    });

    showToast("Message sent to artist.", "success");
    contactArtistBtn.textContent = "Message sent";
    if (contactFormInline) contactFormInline.hidden = true;
    if (contactMessageBody) contactMessageBody.value = "";
    if (contactMessageCounter) contactMessageCounter.textContent = "0 / 2000";

    // Show persistent "View in messages" link near the contact button
    const existingLink = document.getElementById("contact-messages-link");
    if (!existingLink && contactArtistBtn?.parentElement) {
      const link = document.createElement("a");
      link.id = "contact-messages-link";
      link.href = "/account-settings.html?section=bookings";
      link.className = "btn btn-ghost btn-small";
      link.textContent = "View in messages";
      contactArtistBtn.insertAdjacentElement("afterend", link);
    }
  } catch (error) {
    showToast(error?.message || "Message could not be sent.", "danger");
  } finally {
    contactSendBtn.disabled = false;
    contactSendBtn.textContent = "Send message";
  }
});

contactCancelBtn?.addEventListener("click", () => {
  if (contactFormInline) contactFormInline.hidden = true;
});

openBookingBtn?.addEventListener("click", () => {
  if (!artist || !profileIsPublic()) {
    showToast("This creator is not currently open for booking.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot book your own studio.", "warning");
    return;
  }

  const userId = getActiveUserId();
  if (!userId) {
    redirectToAuth();
    return;
  }

  // Smart prefill from artist profile
  if (bookingFocus instanceof HTMLInputElement && !bookingFocus.value) {
    bookingFocus.value = artist.category || "";
  }
  if (bookingBudget && !bookingBudget.value && artist.priceFrom > 0) {
    bookingBudget.value = String(artist.priceFrom);
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
    bookingBudget.value = String(artist.priceFrom || 500);
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
    showToast("This creator is not currently available for booking.", "warning");
    return;
  }

  if (viewerOwnsArtistProfile()) {
    showToast("You cannot book your own studio.", "warning");
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

  const markInvalid = (el, invalid) => { if (el) el.setAttribute("aria-invalid", String(invalid)); };
  markInvalid(bookingFocus, !projectFocus);
  markInvalid(bookingDeadline, !deadline);
  markInvalid(bookingBudget, !budget);
  markInvalid(bookingMessage, !message);

  if (!projectFocus || !deadline || !budget || !message) {
    showToast("Project focus, deadline, budget, and message are required.", "warning");
    return;
  }

  if (!Number.isFinite(budget) || budget < 1 || budget > MAX_BOOKING_BUDGET) {
    markInvalid(bookingBudget, true);
    showToast(`Budget must be between 1 and ${MAX_BOOKING_BUDGET}.`, "warning");
    return;
  }

  const minDate = minBookingDateISO();
  if (deadline < minDate) {
    markInvalid(bookingDeadline, true);
    showToast("Deadline cannot be in the past.", "warning");
    return;
  }

  if (message.length > MAX_BOOKING_MESSAGE_LENGTH) {
    markInvalid(bookingMessage, true);
    showToast(`Message must be ${MAX_BOOKING_MESSAGE_LENGTH} characters or fewer.`, "warning");
    return;
  }

  const submitBtn = bookingForm.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn?.textContent || "Send booking request";

  setBookingFormEnabled(false);
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
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
      setBookingFormEnabled(true);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
      return;
    }

    db = getDB();

    const successDiv = document.createElement("div");
    successDiv.className = "booking-success";
    successDiv.innerHTML = `
      <p class="site-tag">Request sent</p>
      <h2 class="section-title detail-title">Brief submitted.</h2>
      <p class="section-copy">The artist has your request and will respond from their workspace. You can track the status from your bookings.</p>
      <div class="form-actions">
        <a class="btn btn-primary" href="/account-settings.html?section=bookings">View booking</a>
        <a class="btn btn-outline" href="/explore.html">Browse more artists</a>
      </div>
    `;
    bookingForm.replaceWith(successDiv);
  } catch (error) {
    showToast(error?.message || "Booking could not be created.", "danger");
    setBookingFormEnabled(true);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }
});

function renderStars(rating) {
  const full = Math.round(rating);
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    stars += `<span class="star ${i <= full ? "star-filled" : "star-empty"}">${i <= full ? "\u2605" : "\u2606"}</span>`;
  }
  return stars;
}

async function loadAndRenderReviews() {
  const reviewsSection = byId("reviews-section");
  const reviewsGrid = byId("reviews-grid");
  const reviewsTitle = byId("reviews-title");
  if (!reviewsSection || !reviewsGrid || !artist) return;

  try {
    const res = await apiRequest(`/v1/artists/${encodeURIComponent(artist.id)}/reviews`);
    if (!res.ok || !res.data?.items?.length) return;

    const items = res.data.items;
    reviewsSection.hidden = false;
    if (reviewsTitle) {
      reviewsTitle.textContent = `Reviews (${items.length})`;
    }

    reviewsGrid.innerHTML = items.map((review) => {
      const dateStr = new Date(review.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
      return `
        <article class="review-card-public">
          <div class="review-card-head">
            <div class="review-stars">${renderStars(review.rating)}</div>
            <span class="review-date muted">${escapeHtml(dateStr)}</span>
          </div>
          <p class="review-body">${escapeHtml(review.body)}</p>
        </article>
      `;
    }).join("");
  } catch (_) {
    // Silently fail - reviews are non-critical
  }
}

updateBookingCta();
renderArtistDetails();
loadAndRenderReviews();
