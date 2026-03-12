import { apiRequest } from "./api-client.js";
import { getSession } from "./session.js";

export const DB_SCHEMA_VERSION = 2;
const DB_SESSION_CACHE_KEY = "artizans.session.dbcache.v1";
const DB_LOCAL_CACHE_KEY = "artizans.local.dbcache.v1";

export const BOOKING_STATUSES = [
  "requested",
  "accepted",
  "declined",
  "confirmed",
  "payment_pending",
  "paid",
  "completed",
  "cancelled",
];

const DEFAULT_CATEGORIES = [
  "Illustration",
  "Branding",
  "Photography",
  "Character Design",
  "Motion Graphics",
  "UI Design",
  "Album Art",
  "Editorial",
];

const BOOKING_TRANSITIONS = {
  requested: ["accepted", "declined", "cancelled"],
  accepted: ["confirmed", "cancelled"],
  declined: [],
  confirmed: ["payment_pending", "paid", "cancelled"],
  payment_pending: ["paid", "cancelled"],
  paid: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function nowIso() {
  return new Date().toISOString();
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function isoDaysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeArtistRecord(artist, db) {
  if (!artist || typeof artist !== "object") {
    return artist;
  }

  if (!Array.isArray(artist.mediums) || !artist.mediums.length) {
    artist.mediums = ["Digital"];
  }

  if (!Array.isArray(artist.portfolio)) {
    artist.portfolio = [];
  }

  artist.priceFrom = Number(artist.priceFrom || 0);
  artist.profileVisible = Boolean(artist.profileVisible);
  return artist;
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  const savedArtistIds = asArray(user.savedArtistIds).length
    ? asArray(user.savedArtistIds)
    : asArray(user.savedArtists);
  const bookingHistoryIds = asArray(user.bookingHistoryIds).length
    ? asArray(user.bookingHistoryIds)
    : asArray(user.bookingHistory);

  user.bio = String(user.bio || "");
  user.savedArtistIds = [...new Set(savedArtistIds.filter(Boolean))];
  user.savedArtists = [...user.savedArtistIds];
  user.bookingHistoryIds = [...new Set(bookingHistoryIds.filter(Boolean))];
  user.bookingHistory = [...user.bookingHistoryIds];
  user.preferences = {
    bookingUpdates: user.preferences?.bookingUpdates ?? true,
    messageAlerts: user.preferences?.messageAlerts ?? true,
    marketingEmails: user.preferences?.marketingEmails ?? false,
    browserNotifications: user.preferences?.browserNotifications ?? false,
  };
  user.setup = {
    status: user.setup?.status || (user.profileCompleted ? "completed" : "not_started"),
    currentStep: user.setup?.currentStep || (user.profileCompleted ? "done" : "welcome"),
    artistOptIn: Boolean(user.setup?.artistOptIn),
    completedAt: user.setup?.completedAt ?? (user.profileCompleted ? user.updatedAt || user.createdAt || null : null),
  };

  return user;
}

function nextId(prefix, collection) {
  let max = 0;

  for (const item of asArray(collection)) {
    if (!item || typeof item.id !== "string" || !item.id.startsWith(prefix)) {
      continue;
    }
    const numeric = Number(item.id.slice(prefix.length));
    if (Number.isFinite(numeric)) {
      max = Math.max(max, numeric);
    }
  }

  return `${prefix}${max + 1}`;
}

function toTitle(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeIdentity(identity) {
  return {
    sub: String(identity?.sub || "").trim() || null,
    email: String(identity?.email || "").trim() || null,
    username: String(identity?.username || "").trim() || null,
  };
}

function displayNameFromIdentity(identity, fallback = "Member") {
  const normalized = normalizeIdentity(identity);
  const fromUsername = toTitle(normalized.username || "");
  if (fromUsername) {
    return fromUsername;
  }

  const emailPrefix = normalized.email ? normalized.email.split("@")[0] : "";
  const fromEmail = toTitle(emailPrefix);
  if (fromEmail) {
    return fromEmail;
  }

  return fallback;
}

function uniqueArtistHandle(db, baseValue) {
  const base = slugify(baseValue) || "artist";
  const taken = new Set(asArray(db.artists).map((artist) => artist.handle));

  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function createDefaultCategories() {
  return DEFAULT_CATEGORIES.map((name, index) => ({
    id: `c${index + 1}`,
    name,
    active: true,
  }));
}

function createEmptyDB() {
  return {
    schemaVersion: DB_SCHEMA_VERSION,
    users: [],
    artists: [],
    services: [],
    bookings: [],
    messages: [],
    notifications: [],
    reports: [],
    categories: createDefaultCategories(),
    invoices: [],
    payouts: [],
    system: {
      maintenanceMode: false,
      errorLog: [],
    },
  };
}

function isValidDB(db) {
  if (!db || typeof db !== "object") {
    return false;
  }

  if (db.schemaVersion !== DB_SCHEMA_VERSION) {
    return false;
  }

  const listFields = [
    "users",
    "artists",
    "services",
    "bookings",
    "messages",
    "notifications",
    "reports",
    "categories",
    "invoices",
    "payouts",
  ];

  if (!listFields.every((field) => Array.isArray(db[field]))) {
    return false;
  }

  if (!db.system || typeof db.system !== "object") {
    return false;
  }

  if (typeof db.system.maintenanceMode !== "boolean") {
    return false;
  }

  if (!Array.isArray(db.system.errorLog)) {
    return false;
  }

  return true;
}

function parseTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function preferRemoteRecord(existing, remote) {
  if (!existing) {
    return true;
  }
  const remoteTime = parseTime(remote?.updatedAt);
  const localTime = parseTime(existing?.updatedAt);
  if (!remoteTime) {
    return false;
  }
  return remoteTime >= localTime;
}

function selectCanonicalArtistRecord(artists, cognitoSub = null) {
  const matches = asArray(artists)
    .filter((artist) => artist && (!cognitoSub || artist.cognitoSub === cognitoSub));

  if (!matches.length) {
    return null;
  }

  return [...matches].sort((left, right) => {
    const timeDelta = parseTime(right?.updatedAt) - parseTime(left?.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    const visibilityDelta = Number(Boolean(right?.profileVisible)) - Number(Boolean(left?.profileVisible));
    if (visibilityDelta !== 0) {
      return visibilityDelta;
    }

    return parseTime(right?.createdAt) - parseTime(left?.createdAt);
  })[0];
}

function migrateArtistReferences(db, fromArtistId, toArtistId) {
  if (!fromArtistId || !toArtistId || fromArtistId === toArtistId) {
    return;
  }

  asArray(db.services).forEach((service) => {
    if (service.artistId === fromArtistId) {
      service.artistId = toArtistId;
    }
  });

  asArray(db.bookings).forEach((booking) => {
    if (booking.artistId === fromArtistId) {
      booking.artistId = toArtistId;
    }
  });

  asArray(db.messages).forEach((message) => {
    if (message.fromRole === "artist" && message.fromId === fromArtistId) {
      message.fromId = toArtistId;
    }
    if (message.toRole === "artist" && message.toId === fromArtistId) {
      message.toId = toArtistId;
    }
  });

  asArray(db.notifications).forEach((notification) => {
    if (notification.role === "artist" && notification.ownerId === fromArtistId) {
      notification.ownerId = toArtistId;
    }
  });

  asArray(db.invoices).forEach((invoice) => {
    if (invoice.artistId === fromArtistId) {
      invoice.artistId = toArtistId;
    }
  });

  asArray(db.payouts).forEach((payout) => {
    if (payout.artistId === fromArtistId) {
      payout.artistId = toArtistId;
    }
  });
}

function loadSessionDBCache() {
  const storage = getSessionStorage();
  const raw = storage?.getItem(DB_SESSION_CACHE_KEY);
  if (!raw) {
    return null;
  }
  const parsed = safeParse(raw);
  if (!isValidDB(parsed)) {
    storage?.removeItem(DB_SESSION_CACHE_KEY);
    return null;
  }
  return parsed;
}

function loadLocalDBCache() {
  const storage = getLocalStorage();
  const raw = storage?.getItem(DB_LOCAL_CACHE_KEY);
  if (!raw) {
    return null;
  }
  const parsed = safeParse(raw);
  if (!isValidDB(parsed)) {
    storage?.removeItem(DB_LOCAL_CACHE_KEY);
    return null;
  }
  return parsed;
}

function loadDBCache() {
  clearDBCache();
  return null;
}

function persistSessionDBCache(db) {
  void db;
}

function persistLocalDBCache(db) {
  void db;
}

function persistDBCache(db) {
  persistSessionDBCache(db);
  persistLocalDBCache(db);
}

function clearSessionDBCache() {
  const storage = getSessionStorage();
  storage?.removeItem(DB_SESSION_CACHE_KEY);
}

function clearLocalDBCache() {
  const storage = getLocalStorage();
  storage?.removeItem(DB_LOCAL_CACHE_KEY);
}

function clearDBCache() {
  clearSessionDBCache();
  clearLocalDBCache();
}

let dbCache = loadDBCache() || createEmptyDB();
let dbHydrated = false;

function emitStoreUpdated() {
  window.dispatchEvent(new CustomEvent("artizans:store-updated"));
}

function runApiMutation(mutation, fallbackMessage) {
  Promise.resolve()
    .then(() => mutation())
    .catch((error) => {
      console.warn(fallbackMessage || "API mutation failed", error);
    });
}

export async function hydrateDB() {
  if (dbHydrated) {
    return dbCache;
  }

  try {
    const [categoriesResponse, artistsResponse] = await Promise.all([
      apiRequest("/v1/categories", { auth: false }),
      apiRequest("/v1/artists", { auth: false }),
    ]);

    const next = {
      ...createEmptyDB(),
      users: asArray(dbCache.users).map((user) => normalizeUserRecord({ ...user })),
      services: asArray(dbCache.services),
      bookings: asArray(dbCache.bookings),
      messages: asArray(dbCache.messages),
      notifications: asArray(dbCache.notifications),
      invoices: asArray(dbCache.invoices),
      payouts: asArray(dbCache.payouts),
      reports: asArray(dbCache.reports),
      system: dbCache.system || createEmptyDB().system,
    };
    const remoteCategories = asArray(categoriesResponse?.data?.items).map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active !== false,
    }));
    next.categories = remoteCategories.length ? remoteCategories : createDefaultCategories();

    const remoteArtists = asArray(artistsResponse?.data?.items).map((artist) =>
      normalizeArtistRecord(
        {
          id: artist.id,
          cognitoSub: artist.cognitoSub || null,
          cognitoEmail: artist.cognitoEmail || null,
          name: artist.name || "Artist",
          handle: artist.handle || "",
          category: artist.category || "",
          mediums: asArray(artist.mediums),
          location: artist.location || "",
          verified: Boolean(artist.verified),
          popularity: Number(artist.popularity || 0),
          rating: Number(artist.rating || 0),
          reviewCount: Number(artist.reviewCount || 0),
          priceFrom: Number(artist.priceFrom || 0),
          availability: artist.availability || "open",
          bio: artist.bio || "",
          profileVisible: Boolean(artist.profileVisible),
          profileViews: Number(artist.profileViews || 0),
          completedBookings: Number(artist.completedBookings || 0),
          acceptanceRate: Number(artist.acceptanceRate || 0),
          portfolio: asArray(artist.portfolio).map((item) => ({
            id: item.id || `p-${Date.now()}`,
            title: item.title || "Portfolio Item",
            image: item.imageUrl || item.image || "",
          })),
          createdAt: artist.createdAt || localArtistsById.get(artist.id)?.createdAt || nowIso(),
          updatedAt: artist.updatedAt || nowIso(),
        },
        next,
      ),
    );
    next.artists = remoteArtists;

    dbCache = next;
    persistDBCache(dbCache);
    dbHydrated = true;
    emitStoreUpdated();
  } catch (error) {
    console.warn("Store hydration from API failed; using in-memory fallback.", error);
    dbHydrated = true;
  }

  return dbCache;
}

export function getDB() {
  return dbCache;
}

export function saveDB(db) {
  dbCache = isValidDB(db) ? db : dbCache;
  if (Array.isArray(dbCache?.users)) {
    dbCache.users = dbCache.users.map((user) => normalizeUserRecord(user));
  }
  if (Array.isArray(dbCache?.artists)) {
    dbCache.artists = dbCache.artists.map((artist) => normalizeArtistRecord(artist, dbCache));
  }
  persistDBCache(dbCache);
  emitStoreUpdated();
}

export function resetDB() {
  clearDBCache();
  const fresh = createEmptyDB();
  saveDB(fresh);
  return fresh;
}

export function updateDB(mutator) {
  const db = getDB();
  mutator(db);
  saveDB(db);
  return db;
}

export function getArtistById(db, artistId) {
  if (!artistId) {
    return null;
  }
  return asArray(db?.artists).find((artist) => artist.id === artistId) || null;
}

export function isArtistProfileLive(artist) {
  return Boolean(artist?.profileVisible);
}

export function getVisibleArtists(db) {
  return asArray(db?.artists).filter((artist) => isArtistProfileLive(artist));
}

export function getUserById(db, userId) {
  if (!userId) {
    return null;
  }
  return asArray(db?.users).find((user) => user.id === userId) || null;
}

export function getUserByCognitoSub(db, cognitoSub) {
  if (!cognitoSub) {
    return null;
  }
  return asArray(db?.users).find((user) => user.cognitoSub === cognitoSub) || null;
}

export function getArtistByCognitoSub(db, cognitoSub) {
  if (!cognitoSub) {
    return null;
  }
  return selectCanonicalArtistRecord(db?.artists, cognitoSub);
}

export function getServiceById(db, serviceId) {
  if (!serviceId) {
    return null;
  }
  return asArray(db?.services).find((service) => service.id === serviceId) || null;
}

export function getServicesForArtist(db, artistId) {
  if (!artistId) {
    return [];
  }
  return asArray(db?.services).filter((service) => service.artistId === artistId);
}

function createUserRecord(db, identity) {
  const now = nowIso();
  const normalized = normalizeIdentity(identity);

  const created = {
    id: nextId("u", db.users),
    cognitoSub: normalized.sub,
    cognitoEmail: normalized.email,
    name: displayNameFromIdentity(normalized, "New User"),
    email: normalized.email || "",
    location: "",
    bio: "",
    emailVerified: Boolean(normalized.email),
    profileCompleted: false,
    preferences: {
      bookingUpdates: true,
      messageAlerts: true,
      marketingEmails: false,
      browserNotifications: false,
    },
    setup: {
      status: "not_started",
      currentStep: "welcome",
      artistOptIn: false,
      completedAt: null,
    },
    savedArtistIds: [],
    savedArtists: [],
    bookingHistoryIds: [],
    bookingHistory: [],
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };

  db.users.push(normalizeUserRecord(created));
  return normalizeUserRecord(created);
}

function createArtistRecord(db, identity) {
  const now = nowIso();
  const normalized = normalizeIdentity(identity);
  const displayName = displayNameFromIdentity(normalized, "New Artist");
  const firstCategory = asArray(db.categories).find((category) => category.active)?.name || "Illustration";

  const created = {
    id: nextId("a", db.artists),
    cognitoSub: normalized.sub,
    cognitoEmail: normalized.email,
    name: displayName,
    handle: uniqueArtistHandle(db, displayName),
    category: firstCategory,
    mediums: ["Digital"],
    location: "",
    verified: false,
    popularity: 0,
    rating: 0,
    reviewCount: 0,
    priceFrom: 0,
    availability: "open",
    bio: "Add your bio to start receiving requests.",
    profileVisible: false,
    profileViews: 0,
    completedBookings: 0,
    acceptanceRate: 0,
    portfolio: [],
    createdAt: now,
    updatedAt: now,
  };

  db.artists.push(created);
  return normalizeArtistRecord(created, db);
}

function syncIdentityFields(record, identity) {
  const normalized = normalizeIdentity(identity);
  if (!record || !normalized.sub) {
    return;
  }

  if (!record.cognitoSub) {
    record.cognitoSub = normalized.sub;
  }

  if (normalized.email && record.cognitoEmail !== normalized.email) {
    record.cognitoEmail = normalized.email;
    if (Object.prototype.hasOwnProperty.call(record, "email") && !record.email) {
      record.email = normalized.email;
    }
  }

  record.updatedAt = nowIso();
}

export function ensureUserForCognito(identity) {
  const normalized = normalizeIdentity(identity);
  if (!normalized.sub) {
    return null;
  }

  let ensured = null;

  updateDB((db) => {
    let user = getUserByCognitoSub(db, normalized.sub);
    if (!user) {
      user = createUserRecord(db, normalized);
    } else {
      syncIdentityFields(user, normalized);
    }

    normalizeUserRecord(user);

    ensured = { ...user };
  });

  runApiMutation(
    async () => {
      const response = await apiRequest("/v1/me", { method: "GET" });
      const remote = response?.data;
      if (!remote?.id) {
        return;
      }

      updateDB((db) => {
        const existing = getUserByCognitoSub(db, normalized.sub) || getUserById(db, remote.id);
        const remoteIsPreferred = preferRemoteRecord(existing, remote);
        const next = {
          id: (remoteIsPreferred ? remote.id : existing?.id) || remote.id || existing?.id || nextId("u", db.users),
          cognitoSub: remote.cognitoSub || normalized.sub,
          cognitoEmail: remote.cognitoEmail || normalized.email || "",
          name:
            (remoteIsPreferred ? remote.name : "") ||
            existing?.name ||
            remote.name ||
            displayNameFromIdentity(normalized, "New User"),
          email: remote.email || normalized.email || "",
          location: (remoteIsPreferred ? remote.location : "") || existing?.location || remote.location || "",
          bio: (remoteIsPreferred ? remote.bio : "") || existing?.bio || remote.bio || "",
          emailVerified: remoteIsPreferred ? Boolean(remote.emailVerified) : Boolean(existing?.emailVerified || remote.emailVerified),
          profileCompleted: remoteIsPreferred
            ? Boolean(remote.profileCompleted)
            : Boolean(existing?.profileCompleted || remote.profileCompleted),
          preferences: {
            bookingUpdates: remote.preferences?.bookingUpdates ?? existing?.preferences?.bookingUpdates ?? true,
            messageAlerts: remote.preferences?.messageAlerts ?? existing?.preferences?.messageAlerts ?? true,
            marketingEmails: remote.preferences?.marketingEmails ?? existing?.preferences?.marketingEmails ?? false,
            browserNotifications:
              remote.preferences?.browserNotifications ?? existing?.preferences?.browserNotifications ?? false,
          },
          setup: {
            status: remote.setup?.status || existing?.setup?.status || (remote.profileCompleted ? "completed" : "not_started"),
            currentStep: remote.setup?.currentStep || existing?.setup?.currentStep || (remote.profileCompleted ? "done" : "welcome"),
            artistOptIn: remote.setup?.artistOptIn ?? existing?.setup?.artistOptIn ?? false,
            completedAt: remote.setup?.completedAt ?? existing?.setup?.completedAt ?? null,
          },
          savedArtistIds: asArray(existing?.savedArtistIds).length
            ? asArray(existing?.savedArtistIds)
            : asArray(existing?.savedArtists),
          bookingHistoryIds: asArray(existing?.bookingHistoryIds).length
            ? asArray(existing?.bookingHistoryIds)
            : asArray(existing?.bookingHistory),
          deleted: Boolean(existing?.deleted),
          createdAt: remote.createdAt || existing?.createdAt || nowIso(),
          updatedAt: remoteIsPreferred ? remote.updatedAt || nowIso() : existing?.updatedAt || nowIso(),
        };
        normalizeUserRecord(next);

        db.users = asArray(db.users).filter((user) => user.id !== next.id && user.cognitoSub !== next.cognitoSub);
        db.users.push(next);
        ensured = { ...next };
      });
    },
    "Ensuring user via API failed.",
  );

  return ensured;
}

export function ensureArtistForCognito(identity) {
  const normalized = normalizeIdentity(identity);
  if (!normalized.sub) {
    return null;
  }

  let ensured = null;

  updateDB((db) => {
    let artist = getArtistByCognitoSub(db, normalized.sub);
    if (!artist) {
      artist = createArtistRecord(db, normalized);
    } else {
      syncIdentityFields(artist, normalized);
    }
    normalizeArtistRecord(artist, db);
    ensured = { ...artist };
  });

  runApiMutation(
    async () => {
      const response = await apiRequest("/v1/artist/me", { method: "GET" });
      const remote = response?.data;
      if (!remote?.id) {
        return;
      }

      updateDB((db) => {
        const existing = getArtistByCognitoSub(db, normalized.sub) || getArtistById(db, remote.id);
        const remoteIsPreferred = preferRemoteRecord(existing, remote);
        const next = {
          id: (remoteIsPreferred ? remote.id : existing?.id) || remote.id || existing?.id || nextId("a", db.artists),
          cognitoSub: remote.cognitoSub || normalized.sub,
          cognitoEmail: remote.cognitoEmail || normalized.email || "",
          name:
            (remoteIsPreferred ? remote.name : "") ||
            existing?.name ||
            remote.name ||
            displayNameFromIdentity(normalized, "New Artist"),
          handle:
            (remoteIsPreferred ? remote.handle : "") ||
            existing?.handle ||
            remote.handle ||
            uniqueArtistHandle(db, remote.name || "artist"),
          category:
            (remoteIsPreferred ? remote.category : "") ||
            existing?.category ||
            remote.category ||
            "Illustration",
          mediums:
            remoteIsPreferred && asArray(remote.mediums).length
              ? asArray(remote.mediums)
              : asArray(existing?.mediums),
          location: (remoteIsPreferred ? remote.location : "") || existing?.location || remote.location || "",
          verified: remoteIsPreferred ? Boolean(remote.verified) : Boolean(existing?.verified || remote.verified),
          popularity: Number(
            remoteIsPreferred ? remote.popularity || 0 : existing?.popularity || remote.popularity || 0,
          ),
          rating: Number(remoteIsPreferred ? remote.rating || 0 : existing?.rating || remote.rating || 0),
          reviewCount: Number(
            remoteIsPreferred ? remote.reviewCount || 0 : existing?.reviewCount || remote.reviewCount || 0,
          ),
          priceFrom: Number(remoteIsPreferred ? remote.priceFrom || 0 : existing?.priceFrom || remote.priceFrom || 0),
          availability:
            (remoteIsPreferred ? remote.availability : "") || existing?.availability || remote.availability || "open",
          bio: (remoteIsPreferred ? remote.bio : "") || existing?.bio || remote.bio || "",
          profileVisible:
            remoteIsPreferred && typeof remote.profileVisible === "boolean"
              ? remote.profileVisible
              : existing?.profileVisible,
          profileViews: Number(
            remoteIsPreferred ? remote.profileViews || 0 : existing?.profileViews || remote.profileViews || 0,
          ),
          completedBookings: Number(
            remoteIsPreferred
              ? remote.completedBookings || 0
              : existing?.completedBookings || remote.completedBookings || 0,
          ),
          acceptanceRate: Number(
            remoteIsPreferred ? remote.acceptanceRate || 0 : existing?.acceptanceRate || remote.acceptanceRate || 0,
          ),
          portfolio: remoteIsPreferred && asArray(remote.portfolio).length
            ? asArray(remote.portfolio).map((item) => ({
                id: item.id || `p-${Date.now()}`,
                title: item.title || "Portfolio Item",
                image: item.imageUrl || item.image || "",
                medium: item.medium || existing?.mediums?.[0] || "Digital",
              }))
            : asArray(existing?.portfolio),
          createdAt: remote.createdAt || existing?.createdAt || nowIso(),
          updatedAt: remoteIsPreferred ? remote.updatedAt || nowIso() : existing?.updatedAt || nowIso(),
        };
        normalizeArtistRecord(next, db);

        if (existing?.id && existing.id !== next.id) {
          migrateArtistReferences(db, existing.id, next.id);
        }

        db.artists = asArray(db.artists).filter(
          (artist) => artist.id !== next.id && artist.cognitoSub !== next.cognitoSub,
        );
        db.artists.push(next);
        ensured = { ...next };
      });
    },
    "Ensuring artist via API failed.",
  );

  return ensured;
}

function mergeArtistCardIntoDB(db, artistCard) {
  if (!artistCard?.id) {
    return null;
  }

  const existing = getArtistById(db, artistCard.id);
  const next = normalizeArtistRecord(
    {
      ...(existing || {}),
      id: artistCard.id,
      cognitoSub: artistCard.cognitoSub || existing?.cognitoSub || null,
      cognitoEmail: artistCard.cognitoEmail || existing?.cognitoEmail || null,
      name: artistCard.name || existing?.name || "Artist",
      handle: artistCard.handle || existing?.handle || "",
      category: artistCard.category || existing?.category || "",
      mediums: asArray(artistCard.mediums).length ? asArray(artistCard.mediums) : asArray(existing?.mediums),
      location: artistCard.location || existing?.location || "",
      verified: Boolean(artistCard.verified ?? existing?.verified),
      popularity: Number(artistCard.popularity ?? existing?.popularity ?? 0),
      rating: Number(artistCard.rating ?? existing?.rating ?? 0),
      reviewCount: Number(artistCard.reviewCount ?? existing?.reviewCount ?? 0),
      priceFrom: Number(artistCard.priceFrom ?? existing?.priceFrom ?? 0),
      availability: artistCard.availability || existing?.availability || "open",
      bio: artistCard.bio || existing?.bio || "",
      profileVisible:
        typeof artistCard.profileVisible === "boolean"
          ? artistCard.profileVisible
          : (existing?.profileVisible ?? true),
      profileViews: Number(artistCard.profileViews ?? existing?.profileViews ?? 0),
      completedBookings: Number(artistCard.completedBookings ?? existing?.completedBookings ?? 0),
      acceptanceRate: Number(artistCard.acceptanceRate ?? existing?.acceptanceRate ?? 0),
      portfolio: asArray(artistCard.portfolio).length
        ? asArray(artistCard.portfolio).map((item) => ({
            id: item.id || `p-${Date.now()}`,
            title: item.title || "Portfolio Item",
            image: item.imageUrl || item.image || "",
            medium: item.medium || existing?.mediums?.[0] || "Digital",
          }))
        : asArray(existing?.portfolio),
      createdAt: artistCard.createdAt || existing?.createdAt || nowIso(),
      updatedAt: artistCard.updatedAt || existing?.updatedAt || nowIso(),
    },
    db,
  );

  db.artists = asArray(db.artists).filter(
    (artist) => artist.id !== next.id && artist.cognitoSub !== next.cognitoSub,
  );
  db.artists.push(next);
  return next;
}

function mergeUserIntoDB(db, remote) {
  if (!remote?.id) {
    return null;
  }

  const existing = getUserById(db, remote.id) || getUserByCognitoSub(db, remote.cognitoSub);
  const next = normalizeUserRecord({
    ...(existing || {}),
    id: remote.id,
    cognitoSub: remote.cognitoSub || existing?.cognitoSub || null,
    cognitoEmail: remote.cognitoEmail || existing?.cognitoEmail || "",
    name: remote.name || existing?.name || "Member",
    email: remote.email || existing?.email || remote.cognitoEmail || "",
    location: remote.location || existing?.location || "",
    bio: remote.bio || existing?.bio || "",
    emailVerified: Boolean(remote.emailVerified ?? existing?.emailVerified),
    profileCompleted: Boolean(remote.profileCompleted ?? existing?.profileCompleted),
    preferences: remote.preferences || existing?.preferences,
    setup: remote.setup || existing?.setup,
    savedArtistIds: remote.savedArtistIds || existing?.savedArtistIds || existing?.savedArtists || [],
    bookingHistoryIds: remote.bookingHistoryIds || existing?.bookingHistoryIds || existing?.bookingHistory || [],
    deleted: Boolean(remote.deleted ?? existing?.deleted),
    createdAt: remote.createdAt || existing?.createdAt || nowIso(),
    updatedAt: remote.updatedAt || existing?.updatedAt || nowIso(),
  });

  db.users = asArray(db.users).filter((user) => user.id !== next.id && user.cognitoSub !== next.cognitoSub);
  db.users.push(next);
  return next;
}

function replaceOwnerNotifications(db, ownerRole, ownerId, items) {
  db.notifications = asArray(db.notifications).filter(
    (notification) => !(notification.role === ownerRole && notification.ownerId === ownerId),
  );

  asArray(items).forEach((item) => {
    db.notifications.push({
      id: item.id,
      role: item.ownerRole || ownerRole,
      ownerId: item.ownerId || ownerId,
      type: item.type || "update",
      title: item.title || "Update",
      detail: item.detail || "",
      read: Boolean(item.read),
      createdAt: item.createdAt || nowIso(),
      updatedAt: item.updatedAt || item.createdAt || nowIso(),
    });
  });
}

function upsertBookings(db, items) {
  const incoming = asArray(items).map((item) => ({
    id: item.id,
    userId: item.userId,
    artistId: item.artistId,
    serviceId: item.serviceId || null,
    serviceLabel: item.serviceLabel || "",
    budget: Number(item.budget || 0),
    deadline: item.deadline || "",
    message: item.message || "",
    status: item.status || "requested",
    threadId: item.threadId || `t-${item.userId}-${item.artistId}`,
    history: asArray(item.history),
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || nowIso(),
  }));

  const incomingIds = new Set(incoming.map((item) => item.id));
  db.bookings = asArray(db.bookings)
    .filter((booking) => !incomingIds.has(booking.id))
    .concat(incoming);
}

function replaceThreadMessages(db, threadId, items) {
  db.messages = asArray(db.messages).filter((message) => message.threadId !== threadId);
  asArray(items).forEach((item) => {
    db.messages.push({
      id: item.id,
      threadId: item.threadId,
      bookingId: item.bookingId || null,
      fromId: item.fromId,
      toId: item.toId,
      body: item.body || "",
      read: Boolean(item.read),
      createdAt: item.createdAt || nowIso(),
      updatedAt: item.updatedAt || item.createdAt || nowIso(),
    });
  });
}

export async function hydratePrivateDB() {
  const session = getSession();
  if (!session?.cognitoSub) {
    return dbCache;
  }

  const [meResponse, artistResponse] = await Promise.allSettled([
    apiRequest("/v1/me", { method: "GET" }),
    apiRequest("/v1/artist/me", { method: "GET" }),
  ]);

  let userId = session.activeUserId || null;
  let artistId = session.activeArtistId || null;

  updateDB((db) => {
    if (meResponse.status === "fulfilled" && meResponse.value?.data?.id) {
      const user = mergeUserIntoDB(db, meResponse.value.data);
      userId = user?.id || userId;
    }

    if (artistResponse.status === "fulfilled" && artistResponse.value?.data?.id) {
      const artist = mergeArtistCardIntoDB(db, artistResponse.value.data);
      artistId = artist?.id || artistId;
    }
  });

  const followUps = await Promise.allSettled([
    userId ? apiRequest("/v1/me/saved-artists", { method: "GET" }) : Promise.resolve(null),
    userId ? apiRequest("/v1/me/bookings", { method: "GET" }) : Promise.resolve(null),
    userId ? apiRequest("/v1/me/notifications", { method: "GET" }) : Promise.resolve(null),
    artistId ? apiRequest("/v1/artist/me/bookings", { method: "GET" }) : Promise.resolve(null),
    artistId ? apiRequest("/v1/artist/me/notifications", { method: "GET" }) : Promise.resolve(null),
    apiRequest("/v1/threads", { method: "GET" }),
  ]);

  const [
    savedArtistsResponse,
    userBookingsResponse,
    userNotificationsResponse,
    artistBookingsResponse,
    artistNotificationsResponse,
    threadsResponse,
  ] = followUps;

  updateDB((db) => {
    const user = userId ? getUserById(db, userId) : null;
    if (savedArtistsResponse.status === "fulfilled" && user) {
      const items = asArray(savedArtistsResponse.value?.data?.items);
      user.savedArtistIds = items.map((item) => item.id).filter(Boolean);
      user.savedArtists = [...user.savedArtistIds];
      items.forEach((item) => mergeArtistCardIntoDB(db, item));
    }

    if (userBookingsResponse.status === "fulfilled") {
      upsertBookings(db, userBookingsResponse.value?.data?.items);
    }

    if (artistBookingsResponse.status === "fulfilled") {
      upsertBookings(db, artistBookingsResponse.value?.data?.items);
    }

    if (userNotificationsResponse.status === "fulfilled" && userId) {
      replaceOwnerNotifications(db, "user", userId, userNotificationsResponse.value?.data?.items);
    }

    if (artistNotificationsResponse.status === "fulfilled" && artistId) {
      replaceOwnerNotifications(db, "artist", artistId, artistNotificationsResponse.value?.data?.items);
    }
  });

  if (threadsResponse.status === "fulfilled") {
    const threads = asArray(threadsResponse.value?.data?.items);
    const messageResponses = await Promise.allSettled(
      threads.map((thread) => apiRequest(`/v1/threads/${encodeURIComponent(thread.id)}/messages`, { method: "GET" })),
    );

    updateDB((db) => {
      threads.forEach((thread, index) => {
        const response = messageResponses[index];
        if (response?.status === "fulfilled") {
          replaceThreadMessages(db, thread.id, response.value?.data?.items);
        }
      });
    });
  }

  return dbCache;
}

export function addNotification(db, { role, ownerId, type, title, detail }) {
  if (!role || !ownerId) {
    return null;
  }

  const id = nextId("n", db.notifications);
  db.notifications.unshift({
    id,
    role,
    ownerId,
    type: type || "system",
    title: title || "Update",
    detail: detail || "",
    read: false,
    createdAt: nowIso(),
  });
  return id;
}

export async function toggleSaveArtist(userId, artistId) {
  const user = getUserById(getDB(), userId);
  const artist = getArtistById(getDB(), artistId);
  if (!user || !artist) {
    return false;
  }

  const existingIds = asArray(user.savedArtistIds).length ? asArray(user.savedArtistIds) : asArray(user.savedArtists);
  const shouldSave = !existingIds.includes(artistId);

  await apiRequest(`/v1/me/saved-artists/${encodeURIComponent(artistId)}`, {
    method: shouldSave ? "POST" : "DELETE",
  });

  updateDB((db) => {
    const nextUser = getUserById(db, userId);
    if (!nextUser) {
      return;
    }

    const nextIds = shouldSave
      ? Array.from(new Set([artistId, ...asArray(nextUser.savedArtistIds)]))
      : asArray(nextUser.savedArtistIds).filter((id) => id !== artistId);

    nextUser.savedArtistIds = nextIds;
    nextUser.savedArtists = [...nextIds];
    nextUser.updatedAt = nowIso();
  });

  return shouldSave;
}

export async function sendMessage(payload) {
  if (!payload?.toId) {
    return null;
  }

  const threadId = payload.threadId || `t-${payload.fromId}-${payload.toId}`;
  const body = String(payload.body || "").trim();
  if (!threadId || !body) {
    return null;
  }

  const response = await apiRequest(`/v1/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    body: {
      body,
      toId: payload.toId,
      bookingId: payload.bookingId || undefined,
    },
  });

  const createdMessage = response?.data || null;
  if (!createdMessage?.id) {
    return null;
  }

  updateDB((db) => {
    replaceThreadMessages(db, threadId, [
      ...asArray(db.messages).filter((message) => message.threadId === threadId),
      createdMessage,
    ]);
  });

  return createdMessage;
}

function recalcArtistMetrics(db, artistId) {
  const artist = getArtistById(db, artistId);
  if (!artist) {
    return;
  }

  const bookings = db.bookings.filter((booking) => booking.artistId === artistId);
  const accepted = bookings.filter((booking) => ["accepted", "confirmed", "payment_pending", "paid", "completed"].includes(booking.status)).length;
  const completed = bookings.filter((booking) => booking.status === "completed").length;

  artist.completedBookings = completed;
  artist.acceptanceRate = bookings.length ? Math.round((accepted / bookings.length) * 100) : 0;
  artist.popularity = Math.max(0, Number(artist.profileViews || 0)) + bookings.length * 10;
  artist.updatedAt = nowIso();
}

export async function createBooking(payload) {
  const artist = getArtistById(getDB(), payload?.artistId);
  const user = getUserById(getDB(), payload?.userId);
  if (!artist || !user) {
    return null;
  }

  const response = await apiRequest("/v1/bookings", {
    method: "POST",
    body: {
      serviceId: payload.serviceId || undefined,
      artistId: payload.artistId || undefined,
      serviceLabel: payload.serviceLabel || undefined,
      deadline: payload.deadline,
      budget: payload.budget,
      message: payload.message,
    },
  });

  const booking = response?.data || null;
  if (!booking?.id) {
    return null;
  }

  await hydratePrivateDB();
  return booking;
}

export async function updateBookingStatus(bookingId, nextStatus, actorRole = "system") {
  if (!bookingId || !BOOKING_STATUSES.includes(nextStatus)) {
    return { ok: false, booking: null };
  }

  if (actorRole === "artist" && (nextStatus === "accepted" || nextStatus === "declined")) {
    const action = nextStatus === "accepted" ? "accept" : "decline";
    await apiRequest(`/v1/artist/me/bookings/${encodeURIComponent(bookingId)}/${action}`, {
      method: "POST",
      body: {
        note: `Updated by ${actorRole}`,
      },
    });
  } else {
    await apiRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
      method: "POST",
      body: {
        status: nextStatus,
        note: `Updated by ${actorRole}`,
      },
    });
  }

  await hydratePrivateDB();
  const booking = asArray(getDB().bookings).find((item) => item.id === bookingId) || null;
  return { ok: Boolean(booking), booking };
}

export async function markNotificationsRead(role, ownerId) {
  if ((role === "user" || role === "artist") && ownerId) {
    await apiRequest(role === "user" ? "/v1/me/notifications/read-all" : "/v1/artist/me/notifications/read-all", {
      method: "POST",
      body: {},
    });
    await hydratePrivateDB();
    return;
  }

  updateDB((db) => {
    db.notifications.forEach((notification) => {
      if (notification.role === role && notification.ownerId === ownerId) {
        notification.read = true;
      }
    });
  });
}

export function updateArtistVerification(artistId, verified) {
  updateDB((db) => {
    const artist = getArtistById(db, artistId);
    if (!artist) {
      return;
    }

    artist.verified = Boolean(verified);
    artist.updatedAt = nowIso();

    addNotification(db, {
      role: "artist",
      ownerId: artist.id,
      type: "verification",
      title: verified ? "Verification approved" : "Verification removed",
      detail: verified
        ? "Your profile now has a verified badge."
        : "Verification was removed from your profile.",
    });
  });
}

export function updateReportStatus(reportId, status) {
  updateDB((db) => {
    const report = db.reports.find((item) => item.id === reportId);
    if (!report) {
      return;
    }

    report.status = status;
    report.updatedAt = nowIso();
  });
}

export function toggleMaintenance(enabled) {
  updateDB((db) => {
    const value = Boolean(enabled);
    db.system.maintenanceMode = value;
    db.system.errorLog.unshift({
      id: `err${Date.now()}`,
      level: "info",
      message: value ? "Maintenance mode enabled" : "Maintenance mode disabled",
      createdAt: nowIso(),
      resolved: true,
    });
  });
}

export function addCategory(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    return null;
  }

  let category = null;

  updateDB((db) => {
    const existing = db.categories.find((item) => item.name.toLowerCase() === normalized.toLowerCase());
    if (existing) {
      category = existing;
      return;
    }

    category = {
      id: nextId("c", db.categories),
      name: normalized,
      active: true,
    };

    db.categories.push(category);
  });

  return category;
}

export function toggleCategory(categoryId) {
  updateDB((db) => {
    const category = db.categories.find((item) => item.id === categoryId);
    if (!category) {
      return;
    }
    category.active = !category.active;
  });
}

export function addSystemError(message, level = "warning") {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return;
  }

  updateDB((db) => {
    db.system.errorLog.unshift({
      id: `err${Date.now()}`,
      level,
      message: normalizedMessage,
      createdAt: nowIso(),
      resolved: false,
    });
  });
}

export function resolveSystemError(errorId) {
  updateDB((db) => {
    const target = db.system.errorLog.find((item) => item.id === errorId);
    if (!target) {
      return;
    }
    target.resolved = true;
  });
}

export async function updateUserProfile(userId, patch) {
  const user = getUserById(getDB(), userId);
  if (!user) {
    return null;
  }

  const response = await apiRequest("/v1/me/profile", {
    method: "PATCH",
    body: {
      name: String(patch?.name || user.name || "").trim(),
      location: String(patch?.location || user.location || "").trim(),
      bio: String(patch?.bio || user.bio || "").trim(),
    },
  });

  const remote = response?.data || null;
  if (remote?.id) {
    updateDB((db) => {
      mergeUserIntoDB(db, remote);
    });
  }

  return remote;
}

export async function updateUserPreferences(userId, preferences) {
  const user = getUserById(getDB(), userId);
  if (!user) {
    return null;
  }

  const response = await apiRequest("/v1/me/preferences", {
    method: "PATCH",
    body: {
      bookingUpdates: Boolean(preferences?.bookingUpdates),
      messageAlerts: Boolean(preferences?.messageAlerts),
      marketingEmails: Boolean(preferences?.marketingEmails),
      browserNotifications: Boolean(preferences?.browserNotifications),
    },
  });

  const remote = response?.data || null;
  if (remote?.id) {
    updateDB((db) => {
      mergeUserIntoDB(db, remote);
    });
  }

  return remote;
}

export async function updateArtistProfile(artistId, patch) {
  const artist = getArtistById(getDB(), artistId);
  if (!artist) {
    return null;
  }

  const onboardingPatch =
    Object.prototype.hasOwnProperty.call(patch || {}, "category")
    || Object.prototype.hasOwnProperty.call(patch || {}, "mediums")
    || Object.prototype.hasOwnProperty.call(patch || {}, "priceFrom")
    || Object.prototype.hasOwnProperty.call(patch || {}, "portfolio");

  const profileBody = {};
  if (Object.prototype.hasOwnProperty.call(patch || {}, "name")) {
    profileBody.name = patch?.name ?? artist.name;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "handle")) {
    profileBody.handle = patch?.handle ?? artist.handle;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "location")) {
    profileBody.location = patch?.location ?? artist.location;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "bio")) {
    profileBody.bio = patch?.bio ?? artist.bio;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "availability")) {
    profileBody.availability = patch?.availability ?? artist.availability;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "profileVisible")) {
    profileBody.profileVisible = Boolean(patch?.profileVisible);
  }

  const response = onboardingPatch
    ? await apiRequest("/v1/artist/me/onboarding", {
        method: "PUT",
        body: {
          category: patch?.category ?? artist.category,
          mediums: patch?.mediums ?? artist.mediums,
          priceFrom: patch?.priceFrom ?? artist.priceFrom,
          availability: patch?.availability ?? artist.availability,
          bio: patch?.bio ?? artist.bio,
          profileVisible:
            typeof patch?.profileVisible === "boolean" ? patch.profileVisible : artist.profileVisible,
          portfolio: asArray(patch?.portfolio ?? artist.portfolio).map((item) => ({
            id: item.id,
            title: item.title,
            medium: item.medium || artist.mediums?.[0] || "Digital",
            imageUrl: item.image || item.imageUrl || "",
          })),
        },
      })
    : await apiRequest("/v1/artist/me/profile", {
        method: "PATCH",
        body: profileBody,
      });

  const remote = response?.data || null;
  if (remote?.id) {
    updateDB((db) => {
      mergeArtistCardIntoDB(db, remote);
    });
  }

  return remote;
}

export function upsertService(artistId, servicePatch) {
  let saved = null;

  updateDB((db) => {
    const artist = getArtistById(db, artistId);
    if (!artist) {
      return;
    }

    const title = String(servicePatch?.title || "").trim();
    const description = String(servicePatch?.description || "").trim();
    const price = Number(servicePatch?.price || 0);
    const deliveryDays = Number(servicePatch?.deliveryDays || 0);

    if (!title || !description || !Number.isFinite(price) || price <= 0 || !Number.isFinite(deliveryDays) || deliveryDays <= 0) {
      return;
    }

    if (servicePatch?.id) {
      const existing = db.services.find((service) => service.id === servicePatch.id && service.artistId === artistId);
      if (!existing) {
        return;
      }

      Object.assign(existing, {
        title,
        description,
        price,
        deliveryDays,
      });
      saved = existing;
      artist.priceFrom = Math.min(...getServicesForArtist(db, artistId).map((service) => Number(service.price || 0)).filter((amount) => amount > 0), price);
      artist.updatedAt = nowIso();
      return;
    }

    const created = {
      id: nextId("s", db.services),
      artistId,
      title,
      description,
      price,
      deliveryDays,
    };

    db.services.push(created);
    saved = created;

    const prices = getServicesForArtist(db, artistId)
      .map((service) => Number(service.price || 0))
      .filter((amount) => amount > 0);
    artist.priceFrom = prices.length ? Math.min(...prices) : 0;
    artist.updatedAt = nowIso();
  });

  if (saved) {
    runApiMutation(
      async () => {
        const body = {
          title: saved.title,
          description: saved.description,
          price: Number(saved.price || 0),
          deliveryDays: Number(saved.deliveryDays || 0),
        };

        if (servicePatch?.id) {
          await apiRequest(`/v1/artist/me/services/${encodeURIComponent(saved.id)}`, {
            method: "PATCH",
            body,
          });
          return;
        }

        await apiRequest("/v1/artist/me/services", {
          method: "POST",
          body,
        });
      },
      "Saving service via API failed.",
    );
  }

  return saved;
}

export function removeService(artistId, serviceId) {
  updateDB((db) => {
    db.services = db.services.filter((service) => !(service.id === serviceId && service.artistId === artistId));

    const removedBookingIds = db.bookings
      .filter((booking) => booking.serviceId === serviceId)
      .map((booking) => booking.id);

    db.bookings = db.bookings.filter((booking) => booking.serviceId !== serviceId);
    db.messages = db.messages.filter(
      (message) => !(message.bookingId && removedBookingIds.includes(message.bookingId)),
    );
    db.invoices = db.invoices.filter((invoice) => !removedBookingIds.includes(invoice.bookingId));

    const artist = getArtistById(db, artistId);
    if (!artist) {
      return;
    }

    const prices = getServicesForArtist(db, artistId)
      .map((service) => Number(service.price || 0))
      .filter((amount) => amount > 0);
    artist.priceFrom = prices.length ? Math.min(...prices) : 0;
    artist.updatedAt = nowIso();

    const paidTotal = db.bookings
      .filter(
        (booking) =>
          booking.artistId === artistId &&
          (booking.status === "paid" || booking.status === "completed"),
      )
      .reduce((sum, booking) => sum + Number(booking.budget || 0), 0);

    db.payouts = db.payouts.filter((payout) => payout.artistId !== artistId);
    if (paidTotal > 0) {
      db.payouts.unshift({
        id: nextId("pay", db.payouts),
        artistId,
        amount: Number((paidTotal * 0.9).toFixed(2)),
        status: "scheduled",
        date: isoDaysFromNow(2),
      });
    }

    recalcArtistMetrics(db, artistId);
  });

  if (serviceId) {
    runApiMutation(
      async () => {
        await apiRequest(`/v1/artist/me/services/${encodeURIComponent(serviceId)}`, {
          method: "DELETE",
        });
      },
      "Removing service via API failed.",
    );
  }
}

export function deleteUserAccount(userId) {
  let deleted = false;

  updateDB((db) => {
    const existing = getUserById(db, userId);
    if (!existing) {
      return;
    }

    const removedBookings = db.bookings.filter((booking) => booking.userId === userId);
    const bookingIds = removedBookings.map((booking) => booking.id);
    const affectedArtistIds = new Set(removedBookings.map((booking) => booking.artistId));

    db.users = db.users.filter((user) => user.id !== userId);
    db.bookings = db.bookings.filter((booking) => booking.userId !== userId);
    db.messages = db.messages.filter(
      (message) =>
        message.fromId !== userId &&
        message.toId !== userId &&
        !(message.bookingId && bookingIds.includes(message.bookingId)),
    );
    db.notifications = db.notifications.filter(
      (notification) => !(notification.role === "user" && notification.ownerId === userId),
    );
    db.invoices = db.invoices.filter((invoice) => invoice.userId !== userId && !bookingIds.includes(invoice.bookingId));
    db.payouts = db.payouts.filter((payout) => !affectedArtistIds.has(payout.artistId));

    affectedArtistIds.forEach((artistId) => {
      const paidTotal = db.bookings
        .filter(
          (booking) =>
            booking.artistId === artistId &&
            (booking.status === "paid" || booking.status === "completed"),
        )
        .reduce((sum, booking) => sum + Number(booking.budget || 0), 0);

      if (paidTotal > 0) {
        db.payouts.unshift({
          id: nextId("pay", db.payouts),
          artistId,
          amount: Number((paidTotal * 0.9).toFixed(2)),
          status: "scheduled",
          date: isoDaysFromNow(2),
        });
      }
    });

    db.artists.forEach((artist) => recalcArtistMetrics(db, artist.id));

    deleted = true;
  });

  return deleted;
}
