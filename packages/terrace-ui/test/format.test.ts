import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { agoLabel, countdown, parseUsdt, shortKey, usdt } from "../src/format.js";

describe("usdt", () => {
  test("whole amounts render with two decimals", () => {
    expect(usdt(10_000_000n)).toBe("10.00");
    expect(usdt(0n)).toBe("0.00");
    expect(usdt(1000n * 1_000_000n)).toBe("1000.00");
  });

  test("sub-cent precision is never rounded away", () => {
    expect(usdt(23_400_000n)).toBe("23.40");
    expect(usdt(10_000_001n)).toBe("10.000001");
    expect(usdt(1_234_500n)).toBe("1.2345");
  });

  test("negative amounts (P&L) carry the sign", () => {
    expect(usdt(-5_500_000n)).toBe("-5.50");
    expect(usdt(-1n)).toBe("-0.000001");
  });

  test("property: usdt → parseUsdt round-trips exact micros", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (micros) => {
        expect(parseUsdt(usdt(micros))).toBe(micros);
      }),
    );
  });

  test("parseUsdt rejects junk", () => {
    expect(() => parseUsdt("ten quid")).toThrow();
    expect(() => parseUsdt("1.2345678")).toThrow(); // more precision than a micro
  });
});

describe("countdown", () => {
  test("minutes:seconds under an hour", () => {
    expect(countdown(724_000)).toBe("12:04");
    expect(countdown(59_999)).toBe("0:59");
  });

  test("hours appear only when needed", () => {
    expect(countdown(90 * 60_000)).toBe("1:30:00");
    expect(countdown(3_600_000)).toBe("1:00:00");
  });

  test("clamps at zero — never negative", () => {
    expect(countdown(0)).toBe("0:00");
    expect(countdown(-5_000)).toBe("0:00");
  });
});

describe("shortKey", () => {
  test("skips the compressed-key prefix byte and takes four chars", () => {
    expect(shortKey("02abcdef1122")).toBe("abcd");
  });

  test("short inputs come back whole", () => {
    expect(shortKey("0xa")).toBe("0xa");
  });
});

describe("agoLabel", () => {
  test("sub-minute (and future/clock-skew) reads as just now", () => {
    expect(agoLabel(0)).toBe("just now");
    expect(agoLabel(59_000)).toBe("just now");
    expect(agoLabel(-5_000)).toBe("just now");
  });

  test("minutes, hours, then days", () => {
    expect(agoLabel(3 * 60_000)).toBe("3m ago");
    expect(agoLabel(59 * 60_000)).toBe("59m ago");
    expect(agoLabel(2 * 3_600_000)).toBe("2h ago");
    expect(agoLabel(23 * 3_600_000)).toBe("23h ago");
    expect(agoLabel(3 * 86_400_000)).toBe("3d ago");
  });
});
