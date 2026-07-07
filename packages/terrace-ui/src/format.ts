/**
 * Display formatting — tiny, exact, and inverse-tested.
 *
 * `usdt` never rounds: money is bigint micros end to end, so the string shows
 * every micro that exists (two decimals minimum, six maximum). `parseUsdt` is
 * the exact inverse; the property suite round-trips them.
 */

const MICRO = 1_000_000n;

/** USDt micros → display string. "10.00", "23.40", "10.000001" — never rounded. */
export function usdt(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / MICRO;
  const frac = (abs % MICRO).toString().padStart(6, "0");
  const trimmed = frac.replace(/0+$/, "");
  const shown = trimmed.length <= 2 ? frac.slice(0, 2) : trimmed;
  return `${neg ? "-" : ""}${whole}.${shown}`;
}

/** Exact inverse of {@link usdt}. Throws on junk or sub-micro precision. */
export function parseUsdt(s: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) throw new Error(`not a USDt amount: ${s}`);
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = BigInt(m[2]!);
  const frac = BigInt((m[3] ?? "").padEnd(6, "0"));
  return sign * (whole * MICRO + frac);
}

/** Milliseconds → "12:04" (or "1:30:00" past the hour). Clamps at "0:00". */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Short display form of a hex key: skip the 1-byte prefix, take `chars`. */
export function shortKey(hex: string, chars = 4): string {
  return hex.length > 2 + chars ? hex.slice(2, 2 + chars) : hex;
}
