import { apiRequest } from "./api-client.js";

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
  const sessionCached = loadSessionDBCache();
  if (sessionCached) {
    return sessionCached;
  }

  const localCached = loadLocalDBCache();
  if (localCached) {
    const sessionStorage = getSessionStorage();
    sessionStorage?.setItem(DB_SESSION_CACHE_KEY, JSON.stringify(localCached));
    return localCached;
  }

  return null;
}

function persistSessionDBCache(db) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  storage.setItem(DB_SESSION_CACHE_KEY, JSON.stringify(db));
}

function persistLocalDBCache(db) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  storage.setItem(DB_LOCAL_CACHE_KEY, JSON.stringify(db));
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

    const existing = dbCache;
    const next = {
      ...existing,
      schemaVersion: DB_SCHEMA_VERSION,
      categories: createDefaultCategories(),
      artists: [],
    };
    const remoteCategories = asArray(categoriesResponse?.data?.items).map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active !== false,
    }));
    next.categories = remoteCategories.length ? remoteCategories : asArray(existing.categories).length ? existing.categories : createDefaultCategories();

    const localArtistsById = new Map(asArray(existing.artists).map((artist) => [artist.id, artist]));
    next.artists = asArray(artistsResponse?.data?.items).map((artist) => ({
      id: artist.id,
      cognitoSub: artist.cognitoSub || localArtistsById.get(artist.id)?.cognitoSub || null,
      cognitoEmail: artist.cognitoEmail || localArtistsById.get(artist.id)?.cognitoEmail || null,
      name: artist.name || localArtistsById.get(artist.id)?.name || "Artist",
      handle: artist.handle || localArtistsById.get(artist.id)?.handle || "",
      category: artist.category || localArtistsById.get(artist.id)?.category || "",
      mediums: asArray(artist.mediums).length
        ? asArray(artist.mediums)
        : asArray(localArtistsById.get(artist.id)?.mediums),
      location: artist.location || localArtistsById.get(artist.id)?.location || "",
      verified: Boolean(artist.verified),
      popularity: Number(artist.popularity || 0),
      rating: Number(artist.rating || 0),
      reviewCount: Number(artist.reviewCount || 0),
      priceFrom: Number(artist.priceFrom || 0),
      availability: artist.availability || localArtistsById.get(artist.id)?.availability || "open",
      bio: artist.bio || localArtistsById.get(artist.id)?.bio || "",
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
    }));

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
  return asArray(db?.artists).find((artist) => artist.cognitoSub === cognitoSub) || null;
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
    emailVerified: Boolean(normalized.email),
    profileCompleted: false,
    savedArtists: [],
    bookingHistory: [],
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };

  db.users.push(created);
  return created;
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
    profileViews: 0,
    completedBookings: 0,
    acceptanceRate: 0,
    portfolio: [],
    createdAt: now,
    updatedAt: now,
  };

  db.artists.push(created);
  return created;
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

    if (!Array.isArray(user.savedArtists)) {
      user.savedArtists = [];
    }
    if (!Array.isArray(user.bookingHistory)) {
      user.bookingHistory = [];
    }

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
          emailVerified: remoteIsPreferred ? Boolean(remote.emailVerified) : Boolean(existing?.emailVerified || remote.emailVerified),
          profileCompleted: remoteIsPreferred
            ? Boolean(remote.profileCompleted)
            : Boolean(existing?.profileCompleted || remote.profileCompleted),
          savedArtists: asArray(existing?.savedArtists),
          bookingHistory: asArray(existing?.bookingHistory),
          deleted: Boolean(existing?.deleted),
          createdAt: remote.createdAt || existing?.createdAt || nowIso(),
          updatedAt: remoteIsPreferred ? remote.updatedAt || nowIso() : existing?.updatedAt || nowIso(),
        };

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

    if (!Array.isArray(artist.mediums) || !artist.mediums.length) {
      artist.mediums = ["Digital"];
    }
    if (!Array.isArray(artist.portfolio)) {
      artist.portfolio = [];
    }

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

export function toggleSaveArtist(userId, artistId) {
  let saved = false;

  updateDB((db) => {
    const user = getUserById(db, userId);
    const artist = getArtistById(db, artistId);
    if (!user || !artist) {
      return;
    }

    if (!Array.isArray(user.savedArtists)) {
      user.savedArtists = [];
    }

    if (!user.savedArtists.includes(artistId)) {
      user.savedArtists.push(artistId);
      user.updatedAt = nowIso();
      saved = true;

      addNotification(db, {
        role: "user",
        ownerId: userId,
        type: "saved_artist",
        title: `${artist.name} saved`,
        detail: "This artist is now in your saved list.",
      });
      return;
    }

    user.savedArtists = user.savedArtists.filter((id) => id !== artistId);
    user.updatedAt = nowIso();
    saved = false;
  });

  if (artistId) {
    runApiMutation(
      async () => {
        if (saved) {
          await apiRequest(`/v1/me/saved-artists/${encodeURIComponent(artistId)}`, {
            method: "POST",
          });
          return;
        }

        await apiRequest(`/v1/me/saved-artists/${encodeURIComponent(artistId)}`, {
          method: "DELETE",
        });
      },
      "Saving artist via API failed.",
    );
  }

  return saved;
}

export function sendMessage(payload) {
  let createdMessage = null;

  updateDB((db) => {
    if (!payload?.fromRole || !payload?.fromId || !payload?.toRole || !payload?.toId) {
      return;
    }

    const body = String(payload.body || "").trim();
    if (!body) {
      return;
    }

    const message = {
      id: nextId("m", db.messages),
      threadId: payload.threadId || `t-${payload.fromId}-${payload.toId}`,
      bookingId: payload.bookingId || null,
      fromRole: payload.fromRole,
      fromId: payload.fromId,
      toRole: payload.toRole,
      toId: payload.toId,
      body,
      createdAt: nowIso(),
    };

    db.messages.push(message);
    createdMessage = message;

    addNotification(db, {
      role: payload.toRole,
      ownerId: payload.toId,
      type: "message",
      title: "New message",
      detail: body.slice(0, 72),
    });
  });

  if (createdMessage?.threadId && createdMessage?.body) {
    runApiMutation(
      async () => {
        await apiRequest(`/v1/threads/${encodeURIComponent(createdMessage.threadId)}/messages`, {
          method: "POST",
          body: {
            body: createdMessage.body,
            toId: createdMessage.toId,
            bookingId: createdMessage.bookingId || undefined,
          },
        });
      },
      "Sending message via API failed.",
    );
  }

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

export function createBooking(payload) {
  let createdBooking = null;

  updateDB((db) => {
    const service = getServiceById(db, payload?.serviceId);
    const artist = getArtistById(db, payload?.artistId);
    const user = getUserById(db, payload?.userId);

    if (!service || !artist || !user) {
      return;
    }

    if (service.artistId !== artist.id) {
      return;
    }

    const messageText = String(payload.message || "").trim();
    const deadline = String(payload.deadline || "").trim();
    const budget = Number(payload.budget || 0);

    if (!messageText || !deadline || !Number.isFinite(budget) || budget <= 0) {
      return;
    }

    const timestamp = nowIso();
    const booking = {
      id: nextId("b", db.bookings),
      userId: user.id,
      artistId: artist.id,
      serviceId: service.id,
      status: "requested",
      budget,
      deadline,
      message: messageText,
      createdAt: timestamp,
      updatedAt: timestamp,
      timeline: [
        {
          status: "requested",
          at: timestamp,
          note: "Booking created by user",
        },
      ],
    };

    db.bookings.unshift(booking);

    if (!Array.isArray(user.bookingHistory)) {
      user.bookingHistory = [];
    }
    user.bookingHistory.unshift(booking.id);
    user.updatedAt = timestamp;

    addNotification(db, {
      role: "artist",
      ownerId: artist.id,
      type: "booking_request",
      title: `New booking request from ${user.name || "User"}`,
      detail: `${service.title} - ${deadline}`,
    });

    addNotification(db, {
      role: "user",
      ownerId: user.id,
      type: "booking_request",
      title: `Booking ${booking.id} submitted`,
      detail: `Waiting for ${artist.name || "artist"} to respond.`,
    });

    db.messages.push({
      id: nextId("m", db.messages),
      threadId: `t-${user.id}-${artist.id}`,
      bookingId: booking.id,
      fromRole: "user",
      fromId: user.id,
      toRole: "artist",
      toId: artist.id,
      body: messageText,
      createdAt: timestamp,
    });

    recalcArtistMetrics(db, artist.id);
    createdBooking = booking;
  });

  if (payload?.serviceId && payload?.deadline && payload?.budget && payload?.message) {
    runApiMutation(
      async () => {
        await apiRequest("/v1/bookings", {
          method: "POST",
          body: {
            serviceId: payload.serviceId,
            deadline: payload.deadline,
            budget: payload.budget,
            message: payload.message,
          },
        });
      },
      "Creating booking via API failed.",
    );
  }

  return createdBooking;
}

export function updateBookingStatus(bookingId, nextStatus, actorRole = "system") {
  let ok = false;
  let updatedBooking = null;

  updateDB((db) => {
    const booking = db.bookings.find((item) => item.id === bookingId);
    if (!booking) {
      return;
    }

    if (!BOOKING_STATUSES.includes(nextStatus)) {
      return;
    }

    const allowed = BOOKING_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(nextStatus)) {
      return;
    }

    const timestamp = nowIso();
    booking.status = nextStatus;
    booking.updatedAt = timestamp;

    if (!Array.isArray(booking.timeline)) {
      booking.timeline = [];
    }

    booking.timeline.push({
      status: nextStatus,
      at: timestamp,
      note: `Updated by ${actorRole}`,
    });

    const user = getUserById(db, booking.userId);
    const artist = getArtistById(db, booking.artistId);

    if (user) {
      addNotification(db, {
        role: "user",
        ownerId: user.id,
        type: "booking_status",
        title: `Booking ${booking.id}: ${nextStatus}`,
        detail: artist ? `Artist: ${artist.name}` : "Booking updated",
      });
    }

    if (artist) {
      addNotification(db, {
        role: "artist",
        ownerId: artist.id,
        type: "booking_status",
        title: `Booking ${booking.id}: ${nextStatus}`,
        detail: user ? `Client: ${user.name}` : "Booking updated",
      });
    }

    if (nextStatus === "paid" && !db.invoices.some((invoice) => invoice.bookingId === booking.id)) {
      db.invoices.unshift({
        id: nextId("inv", db.invoices),
        bookingId: booking.id,
        userId: booking.userId,
        artistId: booking.artistId,
        amount: booking.budget,
        status: "paid",
        createdAt: timestamp,
      });

      db.payouts.unshift({
        id: nextId("pay", db.payouts),
        artistId: booking.artistId,
        amount: Number((booking.budget * 0.9).toFixed(2)),
        status: "scheduled",
        date: isoDaysFromNow(2),
      });
    }

    recalcArtistMetrics(db, booking.artistId);
    updatedBooking = booking;
    ok = true;
  });

  if (ok && bookingId && nextStatus) {
    runApiMutation(
      async () => {
        if (actorRole === "artist" && (nextStatus === "accepted" || nextStatus === "declined")) {
          const action = nextStatus === "accepted" ? "accept" : "decline";
          await apiRequest(`/v1/artist/me/bookings/${encodeURIComponent(bookingId)}/${action}`, {
            method: "POST",
            body: {
              note: `Updated by ${actorRole}`,
            },
          });
          return;
        }

        await apiRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
          method: "POST",
          body: {
            status: nextStatus,
            note: `Updated by ${actorRole}`,
          },
        });
      },
      "Updating booking status via API failed.",
    );
  }

  return { ok, booking: updatedBooking };
}

export function markNotificationsRead(role, ownerId) {
  updateDB((db) => {
    db.notifications.forEach((notification) => {
      if (notification.role === role && notification.ownerId === ownerId) {
        notification.read = true;
      }
    });
  });

  if (role === "user" && ownerId) {
    runApiMutation(
      async () => {
        await apiRequest("/v1/me/notifications/read-all", {
          method: "POST",
          body: {},
        });
      },
      "Marking notifications read via API failed.",
    );
  }
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

export function updateUserProfile(userId, patch) {
  updateDB((db) => {
    const user = getUserById(db, userId);
    if (!user) {
      return;
    }

    Object.assign(user, patch || {}, { updatedAt: nowIso() });

    if (!Array.isArray(user.savedArtists)) {
      user.savedArtists = [];
    }
    if (!Array.isArray(user.bookingHistory)) {
      user.bookingHistory = [];
    }
  });

  const name = String(patch?.name || "").trim();
  const location = String(patch?.location || "").trim();
  if (name || location) {
    runApiMutation(
      async () => {
        await apiRequest("/v1/me/profile", {
          method: "PATCH",
          body: {
            name,
            location,
          },
        });
      },
      "Updating user profile via API failed.",
    );
  }
}

export function updateArtistProfile(artistId, patch) {
  updateDB((db) => {
    const artist = getArtistById(db, artistId);
    if (!artist) {
      return;
    }

    Object.assign(artist, patch || {}, { updatedAt: nowIso() });

    if (!Array.isArray(artist.mediums) || !artist.mediums.length) {
      artist.mediums = ["Digital"];
    }

    if (!Array.isArray(artist.portfolio)) {
      artist.portfolio = [];
    }

    recalcArtistMetrics(db, artist.id);
  });

  const artist = getArtistById(getDB(), artistId);
  if (!artist) {
    return;
  }

  const onboardingPatch =
    Object.prototype.hasOwnProperty.call(patch || {}, "category")
    || Object.prototype.hasOwnProperty.call(patch || {}, "mediums")
    || Object.prototype.hasOwnProperty.call(patch || {}, "priceFrom")
    || Object.prototype.hasOwnProperty.call(patch || {}, "portfolio");

  runApiMutation(
    async () => {
      if (onboardingPatch) {
        await apiRequest("/v1/artist/me/onboarding", {
          method: "PUT",
          body: {
            category: artist.category,
            mediums: artist.mediums,
            priceFrom: artist.priceFrom,
            availability: artist.availability,
            portfolio: asArray(artist.portfolio).map((item) => ({
              id: item.id,
              title: item.title,
              medium: item.medium || artist.mediums?.[0] || "Digital",
              imageUrl: item.image || item.imageUrl || "",
            })),
          },
        });
        return;
      }

      await apiRequest("/v1/artist/me/profile", {
        method: "PATCH",
        body: {
          name: artist.name,
          handle: artist.handle,
          location: artist.location,
          bio: artist.bio,
          availability: artist.availability,
        },
      });
    },
    "Updating artist profile via API failed.",
  );
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
