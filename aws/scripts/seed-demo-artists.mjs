#!/usr/bin/env node
// Seeds a set of demo artist profiles into the live Artists DynamoDB table.
// For presentation/demo use only. Each record is written as a fully "live"
// artist (verified + profileVisible + complete profile) so it shows up in
// public discovery (Explore, homepage, related profiles).
//
// Usage:
//   1. make sure you're logged in:   aws sso login   (or: aws configure)
//   2. run:                          node aws/scripts/seed-demo-artists.mjs
//
// Env overrides:
//   ARTIZANS_ARTISTS_TABLE   table name (default: artizans-prod-artists)
//   AWS_REGION               region    (default: ap-southeast-2)
//   ARTIZANS_SEED_CREATED_BY createdBy tag (default: seed:demo-artists)

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// AWS SDK v3 lives in backend/node_modules — resolve from there.
const require = createRequire(path.resolve(here, "../../backend/package.json"));
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const TABLE_NAME = process.env.ARTIZANS_ARTISTS_TABLE || "artizans-prod-artists";
const CREATED_BY = process.env.ARTIZANS_SEED_CREATED_BY || "seed:demo-artists";

const now = new Date().toISOString();

// portfolio image helper — self-hosted, same-origin, optimized demo images
// (committed under assets/demo/). same-origin = no third-party DNS/TLS/redirect,
// served straight from CloudFront, and no dependency on an external host being
// up during a live demo. files are named <prefix>-<n>.jpg to match the ids below.
function pic(seed) {
  return `/assets/demo/${seed}.jpg`;
}

function portfolio(prefix, items) {
  return items.map((it, i) => ({
    id: `${prefix}_pf_${i + 1}`,
    title: it.title,
    medium: it.medium,
    imageUrl: pic(`${prefix}-${i + 1}`),
    createdAt: now,
  }));
}

// 8 demo artists, one per seeded category.
const ARTISTS = [
  {
    id: "demo_artist_illustration",
    name: "maya ellison",
    handle: "mayaellison",
    category: "Illustration",
    mediums: ["digital illustration", "ink", "watercolour"],
    location: "Melbourne",
    priceFrom: 180,
    bio: "i draw warm, character-led illustrations for books, brands and small studios. mostly digital, sometimes ink on paper when it needs to feel handmade.",
    rating: 4.8,
    reviewCount: 27,
    popularity: 92,
    portfolio: [
      { title: "forest market", medium: "digital illustration" },
      { title: "the lighthouse keeper", medium: "ink" },
      { title: "morning routine", medium: "watercolour" },
    ],
  },
  {
    id: "demo_artist_branding",
    name: "daniel okafor",
    handle: "danielokafor",
    category: "Branding",
    mediums: ["logo design", "identity systems", "brand guidelines"],
    location: "Sydney",
    priceFrom: 650,
    bio: "i build identities for people starting something real. logo, type, colour, the rules to keep it consistent — no filler, just a brand that holds up.",
    rating: 4.9,
    reviewCount: 41,
    popularity: 95,
    portfolio: [
      { title: "harbour roasters", medium: "identity systems" },
      { title: "field & co", medium: "logo design" },
      { title: "northpoint studio", medium: "brand guidelines" },
    ],
  },
  {
    id: "demo_artist_editorial",
    name: "priya nair",
    handle: "priyanair",
    category: "Editorial",
    mediums: ["editorial illustration", "layout", "infographics"],
    location: "Brisbane",
    priceFrom: 220,
    bio: "editorial work for magazines and news desks. i turn dense stories into images people actually stop on. quick turnarounds, no fuss.",
    rating: 4.7,
    reviewCount: 19,
    popularity: 84,
    portfolio: [
      { title: "the housing piece", medium: "editorial illustration" },
      { title: "climate explainer", medium: "infographics" },
      { title: "weekend cover", medium: "layout" },
    ],
  },
  {
    id: "demo_artist_photography",
    name: "tom whitlock",
    handle: "tomwhitlock",
    category: "Photography",
    mediums: ["portrait", "product", "documentary"],
    location: "Perth",
    priceFrom: 300,
    bio: "photographer working in portrait and product. natural light when i can get it. i shoot people and things so they look like themselves, not a stock photo.",
    rating: 4.8,
    reviewCount: 33,
    popularity: 90,
    portfolio: [
      { title: "studio portraits", medium: "portrait" },
      { title: "ceramics catalogue", medium: "product" },
      { title: "market day", medium: "documentary" },
    ],
  },
  {
    id: "demo_artist_animation",
    name: "sofia mendes",
    handle: "sofiamendes",
    category: "Animation",
    mediums: ["2d animation", "motion graphics", "explainer video"],
    location: "Adelaide",
    priceFrom: 480,
    bio: "i make short 2d animations and motion pieces — explainers, title cards, loops for social. frame by frame when the budget allows, rigged when it doesn't.",
    rating: 4.9,
    reviewCount: 22,
    popularity: 88,
    portfolio: [
      { title: "app launch loop", medium: "motion graphics" },
      { title: "how it works", medium: "explainer video" },
      { title: "title sequence", medium: "2d animation" },
    ],
  },
  {
    id: "demo_artist_mural",
    name: "jack tanaka",
    handle: "jacktanaka",
    category: "Mural",
    mediums: ["spray paint", "acrylic", "large format"],
    location: "Newcastle",
    priceFrom: 900,
    bio: "i paint big. walls, laneways, cafe interiors. bold colour, clean lines, work that holds up at scale and survives a few winters outside.",
    rating: 4.7,
    reviewCount: 15,
    popularity: 80,
    portfolio: [
      { title: "laneway commission", medium: "spray paint" },
      { title: "cafe back wall", medium: "acrylic" },
      { title: "school gym mural", medium: "large format" },
    ],
  },
  {
    id: "demo_artist_packaging",
    name: "hannah brooks",
    handle: "hannahbrooks",
    category: "Packaging",
    mediums: ["packaging design", "label design", "dieline"],
    location: "Hobart",
    priceFrom: 420,
    bio: "packaging and labels for food, drink and skincare. i care about the thing in your hand — the print, the finish, how it reads on a shelf full of noise.",
    rating: 4.8,
    reviewCount: 26,
    popularity: 86,
    portfolio: [
      { title: "cold brew range", medium: "label design" },
      { title: "honey jars", medium: "packaging design" },
      { title: "soap boxes", medium: "dieline" },
    ],
  },
  {
    id: "demo_artist_lettering",
    name: "leo castellano",
    handle: "leocastellano",
    category: "Lettering",
    mediums: ["hand lettering", "calligraphy", "type design"],
    location: "Canberra",
    priceFrom: 250,
    bio: "hand lettering and custom type. signage, book covers, logos that need a human hand. i still rough everything out in pencil before it goes near a screen.",
    rating: 4.9,
    reviewCount: 31,
    popularity: 89,
    portfolio: [
      { title: "pub signage", medium: "hand lettering" },
      { title: "wedding suite", medium: "calligraphy" },
      { title: "display face", medium: "type design" },
    ],
  },
];

function toRecord(a) {
  return {
    id: a.id,
    createdAt: now,
    updatedAt: now,
    createdBy: CREATED_BY,
    version: 1,

    cognitoSub: `demo|${a.id}`,
    cognitoEmail: `${a.handle}@demo.artizans.collective`,

    name: a.name,
    handle: a.handle,
    category: a.category,
    mediums: a.mediums,
    location: a.location,

    verified: true,
    profileVisible: true,
    availability: "open",

    priceFrom: a.priceFrom,
    bio: a.bio,

    popularity: a.popularity,
    rating: a.rating,
    reviewCount: a.reviewCount,
    profileViews: Math.round(a.popularity * 12),
    completedBookings: Math.round(a.reviewCount * 0.8),
    acceptanceRate: 0.95,

    portfolio: portfolio(a.id, a.portfolio),
  };
}

async function main() {
  const client = new DynamoDBClient({ region: REGION });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  console.log(`Seeding ${ARTISTS.length} demo artists into "${TABLE_NAME}" (${REGION})\n`);

  for (const a of ARTISTS) {
    const Item = toRecord(a);
    await doc.send(new PutCommand({ TableName: TABLE_NAME, Item }));
    console.log(`  ✓ ${a.name.padEnd(20)} ${a.category}`);
  }

  console.log(`\nDone. ${ARTISTS.length} demo artists written. They should appear in Explore shortly.`);
  console.log(`To remove them later, delete the items with id prefix "demo_artist_" from ${TABLE_NAME}.`);
}

main().catch((err) => {
  console.error("\nSeed failed:");
  console.error(err?.message || err);
  if (String(err?.name || "").includes("Credentials") || String(err?.message || "").includes("credential")) {
    console.error("\n→ You're not authenticated. Run `aws sso login` (or `aws configure`) and try again.");
  }
  process.exit(1);
});
