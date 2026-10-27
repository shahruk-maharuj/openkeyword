import type { Intent } from "./types";
import { normalize } from "./text";

const TRANSACTIONAL = [
  "buy", "price", "prices", "pricing", "cost", "cheap", "cheapest", "deal", "deals",
  "discount", "coupon", "coupons", "order", "for sale", "near me", "hire", "quote",
  "free shipping", "subscription", "download", "book", "booking",
];
const COMMERCIAL = [
  "best", "top", "review", "reviews", "vs", "versus", "compare", "comparison",
  "alternative", "alternatives", "rated", "recommended", "worth it",
];
const INFORMATIONAL = [
  "how", "what", "why", "when", "where", "who", "which", "can", "does", "is", "are",
  "guide", "tutorial", "examples", "example", "meaning", "definition", "ideas", "tips",
  "learn", "steps",
];
const NAVIGATIONAL = ["login", "log in", "sign in", "official", "website", "app", "contact", "customer service"];

function hasTerm(text: string, term: string): boolean {
  return new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(text);
}

/**
 * Rule-based intent: transactional beats commercial beats navigational
 * beats informational. Cheap, keyless and right most of the time;
 * the AI provider can refine it when a key is configured.
 */
export function classifyIntent(keyword: string): Intent {
  const k = normalize(keyword);
  if (TRANSACTIONAL.some((t) => hasTerm(k, t))) return "transactional";
  if (COMMERCIAL.some((t) => hasTerm(k, t))) return "commercial";
  if (NAVIGATIONAL.some((t) => hasTerm(k, t))) return "navigational";
  if (INFORMATIONAL.some((t) => hasTerm(k, t))) return "informational";
  return "informational";
}

const STOP = new Set(["a", "an", "the", "for", "to", "of", "in", "on", "and", "or", "with", "my", "your", "i", "you", "is", "are", "do", "does", "can"]);

/**
 * Group a keyword by the most meaningful word that isn't part of the seed.
 * "seo tools free" and "free seo tools" both land in "free".
 */
export function clusterFor(keyword: string, seed: string): string {
  const seedWords = new Set(normalize(seed).split(" "));
  const extra = normalize(keyword)
    .split(" ")
    .filter((w) => w && !seedWords.has(w) && !STOP.has(w));
  return extra[0] ?? "(seed)";
}
