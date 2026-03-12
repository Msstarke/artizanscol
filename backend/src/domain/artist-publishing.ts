import type { ArtistRecord } from "./entities.js";

export type ArtistPublishState = "draft" | "ready" | "live";

export type ArtistPublishSummary = {
  publishState: ArtistPublishState;
  publishReady: boolean;
  publishMissingFields: string[];
};

function hasText(value: unknown): boolean {
  return String(value || "").trim().length > 0;
}

function hasMediums(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

function hasPositiveMoney(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

export function getArtistPublishSummary(artist: ArtistRecord): ArtistPublishSummary {
  const missingFields: string[] = [];

  if (!hasText(artist.category)) {
    missingFields.push("What you do");
  }

  if (!hasMediums(artist.mediums)) {
    missingFields.push("Mediums");
  }

  if (!hasPositiveMoney(artist.priceFrom)) {
    missingFields.push("Starting budget");
  }

  const publishReady = missingFields.length === 0;
  const publishState: ArtistPublishState = publishReady
    ? (artist.profileVisible ? "live" : "ready")
    : "draft";

  return {
    publishState,
    publishReady,
    publishMissingFields: missingFields,
  };
}

export function isArtistLive(artist: ArtistRecord): boolean {
  return getArtistPublishSummary(artist).publishState === "live";
}
