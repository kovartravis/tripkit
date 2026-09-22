/** SQLite/Postgres bind params reject `undefined`; normalize to `null`. */
export function n(value: string | undefined | null): string | null {
  return value ?? null;
}
