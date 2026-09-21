import { randomBytes } from 'node:crypto';

/**
 * Entity id prefixes. Short, prefixed ids are easier for an agent to keep
 * straight in a conversation than bare UUIDs ("flt_" is obviously a flight).
 */
export const ID_PREFIX = {
  trip: 'trp',
  person: 'per',
  flight: 'flt',
  stay: 'sty',
  day: 'day',
  block: 'blk',
  packingItem: 'pck',
} as const;

export type EntityKind = keyof typeof ID_PREFIX;

// Crockford-style base32 without ambiguous characters (no I, L, O, U).
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function newId(kind: EntityKind, length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  }
  return `${ID_PREFIX[kind]}_${out}`;
}
