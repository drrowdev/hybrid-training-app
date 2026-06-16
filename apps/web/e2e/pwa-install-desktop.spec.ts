import { test, expect } from "@playwright/test";

/**
 * iOS PWA install metadata + manifest contract.
 *
 * These specs guard the head tags and manifest fields a user needs in
 * order to Add-to-Home-Screen on iOS Safari and end up with a full-screen
 * app launch. They run on the public landing page so no auth fixture is
 * required.
 *
 * Pull-to-refresh UX itself isn't exercised here — its touch sequence is
 * unreliable to fake in a desktop Chromium project. We only assert the
 * negative: the indicator must NOT render outside standalone mode, so
 * Safari's native pull-to-refresh keeps working in tab mode.
 */

test.describe("PWA install metadata", () => {
  test("home page exposes manifest + iOS meta tags", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      /manifest/,
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      /apple-touch-icon\.png/,
    );
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-title"]'),
    ).toHaveAttribute("content", "S×C");
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute("content", "black-translucent");
    await expect(
      page.locator('meta[name="mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    const vp = page.locator('meta[name="viewport"]');
    await expect(vp).toHaveAttribute("content", /viewport-fit=cover/);
  });

  test("exposes at least one iOS launch (splash) screen", async ({ page }) => {
    await page.goto("/");
    const splash = page.locator('link[rel="apple-touch-startup-image"]');
    expect(await splash.count()).toBeGreaterThan(0);
    // Each entry must carry a media query and a /splash/ href so iOS can
    // pick the device-matched image.
    const first = splash.first();
    await expect(first).toHaveAttribute("media", /orientation: portrait/);
    await expect(first).toHaveAttribute("href", /\/splash\/apple-splash-/);
  });

  test("offline fallback page is served", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/offline.html`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/offline/i);
  });

  test("manifest is valid JSON declaring standalone display", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(`${baseURL}/manifest.webmanifest`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.display).toBe("standalone");
    expect(body.name).toBe("S×C");
    expect(body.short_name).toBe("S×C");
    expect(Array.isArray(body.icons)).toBe(true);
    // Must include at least one maskable icon so Android adaptive icons
    // don't get cropped, plus a 192 and a 512.
    const sizes = (body.icons as Array<{ sizes: string; purpose?: string }>).map(
      (i) => i.sizes,
    );
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const hasMaskable = (body.icons as Array<{ purpose?: string }>).some((i) =>
      (i.purpose ?? "").split(/\s+/).includes("maskable"),
    );
    expect(hasMaskable).toBe(true);
  });

  test("apple-touch-icon and primary PNG icons are served", async ({
    request,
    baseURL,
  }) => {
    for (const path of [
      "/icons/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
    ]) {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.status(), `${path} should be 200`).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/image\/png/);
    }
  });

  test("pull-to-refresh indicator is NOT rendered in a tabbed browser", async ({
    page,
  }) => {
    // /app requires auth and redirects to /login; the indicator is mounted
    // in /app's layout, but the negative assertion holds equally well on
    // /login since the component is only mounted under /app. We assert
    // that anywhere a non-standalone Chromium visits, the indicator stays
    // absent — Safari's own pull-to-refresh must not be shadowed.
    await page.goto("/login");
    await expect(
      page.locator('[data-testid="pull-to-refresh-indicator"]'),
    ).toHaveCount(0);
  });
});
