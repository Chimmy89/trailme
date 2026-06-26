import { describe, it, expect } from "vitest";
import { mergePoints, type LivePoint, type PosPayload } from "./livePoints";

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

function pos(guard: string, agoMs: number, extra: Partial<PosPayload> = {}): PosPayload {
  return {
    guard_id: guard,
    display_name: guard,
    color: "#abc",
    lat: 59.91,
    lon: 10.75,
    captured_at: iso(NOW - agoMs),
    ...extra,
  };
}

describe("mergePoints", () => {
  it("appends a first fix for a guard", () => {
    const out = mergePoints([], [pos("g1", 0)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.guard_id).toBe("g1");
  });

  it("REPLACES within a guard's 5s bucket (decimation), keeping the newer fix", () => {
    const prev = mergePoints([], [pos("g1", 4000, { lon: 10.0 })], NOW); // 4s ago
    const out = mergePoints(prev, [pos("g1", 1000, { lon: 11.0 })], NOW); // 3s later (<5s)
    expect(out).toHaveLength(1);
    expect(out[0]?.lon).toBe(11.0); // replaced with newer
  });

  it("APPENDS when the next fix is in a new 5s bucket", () => {
    const prev = mergePoints([], [pos("g1", 8000)], NOW);
    const out = mergePoints(prev, [pos("g1", 0)], NOW); // 8s later (>=5s)
    expect(out).toHaveLength(2);
  });

  it("keeps ~1pt/5s for a continuous 1Hz stream (fixed buckets, not sliding) so peer trails build", () => {
    // A moving peer pushes ~every 1s; fixed epoch buckets must keep one freshest
    // point PER 5s window. A sliding-gap impl would collapse this to a single
    // perpetually-replaced point and the trail (needs >=2 points) would never form.
    const fixes: PosPayload[] = [];
    for (let ago = 12000; ago >= 0; ago -= 1000) fixes.push(pos("g1", ago));
    const out = mergePoints([], fixes, NOW);
    const buckets = new Set(fixes.map((f) => Math.floor(Date.parse(f.captured_at) / 5000)));
    expect(out).toHaveLength(buckets.size);
    expect(out.length).toBeGreaterThan(1);
  });

  it("drops an out-of-order older fix (preserves newest-last)", () => {
    const prev = mergePoints([], [pos("g1", 1000)], NOW); // newest
    const out = mergePoints(prev, [pos("g1", 60_000)], NOW); // older arrives late
    expect(out).toHaveLength(1);
    expect(Date.parse(out[0]!.captured_at)).toBe(NOW - 1000);
  });

  it("keeps separate guards independent", () => {
    const out = mergePoints([], [pos("g1", 0), pos("g2", 0)], NOW);
    expect(out.map((p) => p.guard_id).sort()).toEqual(["g1", "g2"]);
  });

  it("preserves oldest-first order per guard across appends", () => {
    let buf: LivePoint[] = [];
    for (const ago of [30_000, 20_000, 10_000, 0]) buf = mergePoints(buf, [pos("g1", ago)], NOW);
    const ts = buf.filter((p) => p.guard_id === "g1").map((p) => Date.parse(p.captured_at));
    expect(ts).toEqual([...ts].sort((a, b) => a - b)); // ascending = oldest-first
    expect(buf).toHaveLength(4);
  });

  it("prunes fixes older than 120 minutes", () => {
    const prev: LivePoint[] = [
      { guard_id: "g1", display_name: "g1", color: "#abc", lat: 59.91, lon: 10.75, captured_at: iso(NOW - 121 * 60_000) },
    ];
    const out = mergePoints(prev, [pos("g1", 0)], NOW);
    expect(out).toHaveLength(1);
    expect(Date.parse(out[0]!.captured_at)).toBe(NOW); // only the fresh one survives
  });

  it("skips a fix with an unparseable captured_at", () => {
    const out = mergePoints([], [pos("g1", 0), { ...pos("g2", 0), captured_at: "nope" }], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.guard_id).toBe("g1");
  });

  it("a same-position fallback row (identical captured_at) does not grow the buffer", () => {
    const prev = mergePoints([], [pos("g1", 0)], NOW);
    const same = mergePoints(prev, [pos("g1", 0)], NOW); // dt==0 -> replace
    expect(same).toHaveLength(1);
  });
});
