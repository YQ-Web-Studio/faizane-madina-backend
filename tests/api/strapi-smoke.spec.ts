import { test, expect } from "@playwright/test";

test.describe("Strapi API Smoke Tests", () => {
  test("GET /_health returns healthy status", async ({ request }) => {
    const response = await request.get("/_health");
    expect([200, 204]).toContain(response.status());
  });

  test("GET /api/announcements returns valid JSON array", async ({ request }) => {
    const response = await request.get("/api/announcements");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /api/services returns valid services payload", async ({ request }) => {
    const response = await request.get("/api/services");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /api/timetables returns timetable data structure", async ({ request }) => {
    const response = await request.get("/api/timetables");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("data");
  });

  test("GET /admin serves Strapi Admin panel HTML", async ({ request }) => {
    const response = await request.get("/admin");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
  });
});
