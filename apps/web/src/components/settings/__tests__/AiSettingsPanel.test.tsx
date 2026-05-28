/**
 * AiSettingsPanel — render-only coverage.
 *
 * The project's vitest config runs in `node` without jsdom, so we
 * exercise the static markup produced by `renderToStaticMarkup` to
 * confirm:
 *   - the Recommended-tier model is selected by default,
 *   - the custom-mode dropdown becomes disabled when custom mode is
 *     pre-seeded (saved model is a non-curated string),
 *   - the "Key configured" status surfaces the active model label.
 *
 * Interactive paths (clicking the custom-mode toggle, save round-trip,
 * etc.) are covered by the action / schema / validate-model tests.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The component imports server actions that pull in `next/headers`.
// Stub the actions module so a render doesn't drag the server tree in.
vi.mock("@/lib/ai/actions", () => ({
  setByoaiKey: vi.fn(async () => ({ ok: true })),
  setAiOptIn: vi.fn(async () => ({ ok: true })),
  clearByoaiKey: vi.fn(async () => ({ ok: true })),
}));

import { AiSettingsPanel } from "../AiSettingsPanel";
import { getDefaultModel } from "@/lib/ai/providers/model-catalogue";

describe("AiSettingsPanel — render", () => {
  it("default-renders the Recommended-tier model as the selected option", () => {
    const html = renderToStaticMarkup(
      <AiSettingsPanel
        initialOptedIn={false}
        initialProvider={null}
        initialKeyConfigured={false}
        initialModel={null}
      />,
    );
    const defaultId = getDefaultModel("anthropic");
    // The selected option for the model picker should be the
    // Recommended default for anthropic (the fallback provider).
    expect(html).toContain(`value="${defaultId}" selected=""`);
    // Tier groupings are present.
    expect(html).toContain('label="Most capable"');
    expect(html).toContain('label="Recommended"');
    expect(html).toContain('label="Fast &amp; cheap"');
    // Custom toggle is rendered and pricing link is shown.
    expect(html).toContain('data-testid="ai-model-custom-toggle"');
    expect(html).toContain('data-testid="ai-model-pricing-link"');
  });

  it("shows 'Key configured · <label>' when a curated model is saved", () => {
    const html = renderToStaticMarkup(
      <AiSettingsPanel
        initialOptedIn={true}
        initialProvider="anthropic"
        initialKeyConfigured={true}
        initialModel="claude-sonnet-4-6"
      />,
    );
    expect(html).toContain("Key configured");
    expect(html).toContain("Claude Sonnet 4.6");
  });

  it("falls back to 'Custom: <id>' in the status when the saved model is non-curated", () => {
    const html = renderToStaticMarkup(
      <AiSettingsPanel
        initialOptedIn={true}
        initialProvider="anthropic"
        initialKeyConfigured={true}
        initialModel="my-private-snapshot-2026"
      />,
    );
    expect(html).toContain("Key configured");
    expect(html).toContain("Custom: my-private-snapshot-2026");
  });

  it("disables the curated dropdown when custom mode is pre-seeded from a non-curated saved id", () => {
    const html = renderToStaticMarkup(
      <AiSettingsPanel
        initialOptedIn={false}
        initialProvider="anthropic"
        initialKeyConfigured={false}
        initialModel="my-private-snapshot-2026"
      />,
    );
    // The model select renders with `disabled` attribute when
    // customMode is on.
    expect(html).toMatch(/data-testid="ai-model-select"[^>]*disabled/);
    // The custom input is enabled and pre-filled with the saved id.
    expect(html).toContain(
      'value="my-private-snapshot-2026"',
    );
  });
});
