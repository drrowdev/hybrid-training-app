/**
 * Tests for the Integrations sub-hub page.
 *
 * The page is a server component that reads `strava_connections` and renders
 * its `SettingsHubCard`. We mock the Supabase server module so we can drive
 * both badge states without touching a DB,
 * then `renderToStaticMarkup` the resolved JSX tree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Row = { data: Record<string, unknown> | null };

const stravaResult: { value: Row } = { value: { data: null } };

function makeBuilder(result: { value: Row }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve(result.value)),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "strava_connections") return makeBuilder(stravaResult);
      throw new Error(`unexpected table ${table}`);
    }),
  })),
  getAuthUser: vi.fn(async () => ({
    data: { user: { id: "user-1" } },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect to ${path}`);
  },
}));

import IntegrationsSettingsPage from "../page";

async function renderPage(): Promise<string> {
  const el = await IntegrationsSettingsPage();
  return renderToStaticMarkup(el as React.ReactElement);
}

describe("IntegrationsSettingsPage", () => {
  beforeEach(() => {
    stravaResult.value = { data: null };
  });

  it("renders only the Strava integration card", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="settings-hub-integrations-strava"');
    expect(html).toContain('href="/app/settings/strava"');
    expect(html).not.toContain("AI providers");
    expect(html).not.toContain("/app/settings/ai");
  });

  it("shows 'Not connected' Strava badge when there is no strava_connections row", async () => {
    stravaResult.value = { data: null };
    const html = await renderPage();
    expect(html).toContain("Not connected");
  });

  it("shows 'Connected' Strava badge when a strava_connections row exists", async () => {
    stravaResult.value = { data: { athlete_id: 42 } };
    const html = await renderPage();
    expect(html).toContain("Connected");
    expect(html).not.toContain("Not connected");
  });
});
