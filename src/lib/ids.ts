import { customAlphabet } from "nanoid";

// Post IDs surface publicly as short base58 slugs (plan §5): singletake.gg/a/3vKx9q
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const slug = customAlphabet(BASE58, 6);
export const longSlug = customAlphabet(BASE58, 12);

/** uuid v4 (Node crypto). Used for internal entity ids. */
export function uuid(): string {
  return crypto.randomUUID();
}
