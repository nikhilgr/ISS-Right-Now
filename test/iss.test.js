import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALT_KM,
  SPEED_KMH,
  buildPropagator,
  elevationDeg,
  fetchISSNow,
  geographicFeature,
  nearestCity,
  nextPasses,
} from "../src/iss";

describe("ISS helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes the wheretheiss.at live response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        latitude: "12.5",
        longitude: "-44.25",
        altitude: "410.4",
        velocity: "27600",
        timestamp: 1710000000,
      }),
    })));

    await expect(fetchISSNow()).resolves.toEqual({
      lat: 12.5,
      lon: -44.25,
      alt: 410.4,
      velocity: 27600,
      source: "wheretheiss",
      ts: 1710000000,
    });
  });

  it("falls back to open-notify response shape", async () => {
    vi.stubGlobal("fetch", vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iss_position: { latitude: "1.25", longitude: "2.5" },
          timestamp: 1710000100,
        }),
      }));

    await expect(fetchISSNow()).resolves.toEqual({
      lat: 1.25,
      lon: 2.5,
      alt: ALT_KM,
      velocity: SPEED_KMH,
      source: "open-notify",
      ts: 1710000100,
    });
  });

  it("finds the nearest bundled city", () => {
    const city = nearestCity(34.05, -118.25);

    expect(city.name).toBe("Los Angeles");
    expect(city.country).toBe("United States");
    expect(city.distanceKm).toBeLessThan(10);
  });

  it("returns specific natural feature labels and search queries", () => {
    expect(geographicFeature(23.5, 12)).toEqual({
      label: "the Sahara Desert",
      searchQuery: "Sahara Desert, North Africa",
    });
    expect(geographicFeature(39.5, 101)).toEqual({
      label: "the Gobi Desert",
      searchQuery: "Gobi Desert, Mongolia and China",
    });
    expect(geographicFeature(-22.5, -70)).toEqual({
      label: "the Atacama Desert",
      searchQuery: "Atacama Desert, Chile",
    });
    expect(geographicFeature(-20, -145)).toEqual({
      label: "the South Pacific Ocean",
      searchQuery: "South Pacific Ocean",
    });
  });

  it("returns a high elevation when the ISS is overhead", () => {
    expect(elevationDeg(10, 20, 10, 20)).toBeCloseTo(90, 5);
  });

  it("wraps propagated longitude into the visible world range", () => {
    const at = buildPropagator(
      { lat: 0, lon: 179.5, alt: ALT_KM, velocity: SPEED_KMH, ts: 1000 },
      { lat: -1, lon: 178, alt: ALT_KM, velocity: SPEED_KMH, ts: 900 },
    );

    for (let t = 1000; t < 20000; t += 600) {
      const point = at(t);
      expect(point.lon).toBeGreaterThanOrEqual(-180);
      expect(point.lon).toBeLessThanOrEqual(180);
    }
  });

  it("generates pass records with timing and direction metadata", () => {
    const startTs = 1000;
    const propagator = (t) => ({
      lat: 0,
      lon: ((t - startTs) / 60) - 20,
    });

    const passes = nextPasses(propagator, 0, 0, startTs, 4, 1);

    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({
      start: expect.any(Number),
      end: expect.any(Number),
      duration: expect.any(Number),
      maxEl: expect.any(Number),
      dirFrom: expect.any(String),
      dirTo: expect.any(String),
    });
    expect(passes[0].maxEl).toBeGreaterThanOrEqual(10);
  });
});
