// Connection ids are chosen by the browser (crypto.randomUUID) and only ever
// used as map keys, but keep them short and boring anyway.
export function isConnId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
}
