import { foldText } from "./normalize";

/** Minimum Jaccard similarity of the token sets for two rows to count as "similar". */
export const SIMILARITY_THRESHOLD = 0.5;

/** Distinct lower-case, diacritics-free alphanumeric tokens (length >= 2) of the given texts. */
export function textTokens(...texts: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const token of foldText(text).split(" ")) {
      if (token.length >= 2) out.add(token);
    }
  }
  return out;
}

/**
 * Jaccard similarity |A ∩ B| / |A ∪ B| of two token sets; 0 when either set is empty
 * (nothing to compare is not evidence of a duplicate).
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export const areSimilar = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  jaccard(a, b) >= SIMILARITY_THRESHOLD;
