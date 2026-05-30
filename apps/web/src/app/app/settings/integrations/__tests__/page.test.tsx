/**
 * Tests for the Integrations sub-hub page.
 *
 * The page is a server component that reads two rows (`strava_connections`,
 * `profiles`) and renders two `SettingsHubCard`s. We mock the supabase
 * server module so we can drive both badge states without touching a DB,
 * then `renderToStaticMarkup` the resolved JSX tree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Row = { data: Record<string, unknown> | null };

const stravaResult: { value: Row } = { value: { data: null } };
const profileResult: { value: Row } = { value: { data: null } };

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
      if (table === "profiles") return makeBuilder(profileResult);
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
    profileResult.value = { data: null };
  });

  it("renders both Strava and AI provider cards with the spec hrefs", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="settings-hub-integrations-strava"');
    expect(html).toContain('data-testid="settings-hub-integrations-ai"');
    expect(html).toContain('href="/app/settings/strava"');
    expect(html).toContain('href="/app/settings/ai"');
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

  it("shows 'Not set' AI badge when byoai_key_vault_id is null", async () => {
    profileResult.value = { data: { byoai_key_vault_id: null } };
    const html = await renderPage();
    expect(html).toContain("Not set");
  });

  it("shows 'Configured' AI badge when byoai_key_vault_id is present", async () => {
    profileResult.value = {
      data: { byoai_key_vault_id: "11111111-1111-4111-8111-111111111111" },
    };
    const html = await renderPage();
    expect(html).toContain("Configured");
    expect(html).not.toContain("Not set");
  });
});
