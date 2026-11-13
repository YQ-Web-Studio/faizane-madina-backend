import { describe, it, expect } from "vitest";

// Logic extracted from src/api/timetable/content-types/timetable/lifecycles.ts
function sanitizePrayerData(data: Record<string, any>) {
  if (data && data.prayerData && typeof data.prayerData !== "string") {
    return JSON.stringify(data.prayerData);
  }
  return data?.prayerData;
}

describe("Timetable Lifecycle Safeguards", () => {
  it("serializes prayerData array/object to JSON string to prevent PostgreSQL array syntax error", () => {
    const mockRaw = {
      prayerData: [
        { day: 1, fajr: "05:00", dhuhr: "12:30", asr: "15:45", maghrib: "18:10", isha: "19:30" }
      ]
    };
    const result = sanitizePrayerData(mockRaw);
    expect(typeof result).toBe("string");
    expect(JSON.parse(result)).toEqual(mockRaw.prayerData);
  });

  it("leaves already serialized string untouched", () => {
    const mockString = JSON.stringify([{ day: 1, fajr: "05:00" }]);
    const result = sanitizePrayerData({ prayerData: mockString });
    expect(result).toBe(mockString);
  });
});
