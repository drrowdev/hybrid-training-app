import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanProgramActions } from "./PlanProgramActions";
import { EndBlockForm } from "./EndBlockForm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { JsxEmit, ScriptTarget, transpileModule } from "typescript";

const endAction = vi.fn(async () => {});

describe("PlanProgramActions", () => {
  it("keeps Edit and History visible while rare actions stay in overflow", () => {
    const html = renderToStaticMarkup(
      <PlanProgramActions
        blockId="block"
        canEdit
        editHref="/app/program?edit=block"
        startNewHref="/app/plan?new=1"
        endAction={endAction}
      />,
    );
    expect(html).toContain("Edit program");
    expect(html).toContain("History");
    expect(html).toContain('aria-label="More program actions"');
    expect(html).not.toContain("Start a new program");
    expect(html).not.toContain("End program");
  });
  it("renders lifecycle controls without awaiting optional recovery availability", () => {
    const html = renderToStaticMarkup(<PlanProgramActions blockId="block" canEdit={false}
      editHref="/app/program" startNewHref="/app/program" endAction={endAction}
      recoveryAvailable={new Promise(() => {})} recoveryControl={<span />} />);
    expect(html).toContain('data-testid="program-actions-more"');
    expect(html).not.toContain('data-testid="edit-plan"');
  });
});

describe("streamed Plan recovery offers", () => {
  const source = readFileSync(resolve(__dirname, "../../app/app/plan/page.tsx"), "utf8");
  const helper = source.slice(source.indexOf("async function loadRecoveryOffers("), source.indexOf("async function RecoverySection("));
  function load({ fatigue = false, skip = false, early = false } = {}) {
    const preview = vi.fn(async (_date?: string, boundary?: string) => ({ id: boundary ?? "current" }));
    const card = ({ variant, preview }: { variant?: string; preview?: { id: string } }) =>
      <span data-variant={variant} data-preview={preview?.id} />;
    const offers = runInNewContext(transpileModule(`${helper}\nloadRecoveryOffers;`, {
      compilerOptions: { target: ScriptTarget.ES2022, jsx: JsxEmit.React },
    }).outputText, {
      React,
      getVolumeAutoregOffer: async () => null,
      getLimitationResponseOffer: async () => null,
      getDeloadSkipOffer: async () => skip ? {} : null,
      getEarlyDeloadRecommendation: async () => early ? {} : null,
      getDeloadWeekFatigueSignal: async () => fatigue,
      previewDeloadWeekAction: preview,
      LimitationResponseCard: card, VolumeAutoregCard: card, EarlyDeloadCard: card,
      DeloadSkipCard: card, DeloadWeekCard: card,
      applyLimitationResponseSelection: vi.fn(), acceptVolumeAutoregResult: vi.fn(),
      acceptEarlyDeload: vi.fn(), acceptDeloadSkip: vi.fn(),
      insertDeloadWeekAction: vi.fn(), dismissProgramRecommendation: vi.fn(),
    }) as (blockId: string, params: { deload?: string; boundary?: string; rec?: string }) =>
      Promise<{ banners: React.ReactElement; control: React.ReactElement | null }>;
    return { offers, preview };
  }

  it("retains the quiet control without adding a banner or loading copy", async () => {
    const { offers, preview } = load();
    const result = await offers("owned-block", {});
    expect(renderToStaticMarkup(result.banners)).toBe("");
    expect(renderToStaticMarkup(result.control!)).toContain('data-variant="quiet"');
    expect(preview).toHaveBeenCalledOnce();
    expect(preview).toHaveBeenCalledWith(undefined, undefined, undefined, "owned-block");
  });

  it("retains the recommendation's own anchor and block in a deep-linked banner", async () => {
    const { offers, preview } = load();
    const result = await offers("owned-block", { deload: "1", boundary: "owned-boundary", rec: "owned-rec" });
    expect(preview).toHaveBeenLastCalledWith(undefined, "owned-boundary", "owned-rec", "owned-block");
    expect(renderToStaticMarkup(result.banners)).toContain('data-preview="owned-boundary"');
    expect(result.control).toBeNull();
  });

  it.each([{ skip: true }, { early: true }])("keeps programmed recovery precedence: %j", async (flags) => {
    const { offers } = load({ fatigue: true, ...flags });
    const result = await offers("owned-block", {});
    expect(renderToStaticMarkup(result.banners)).not.toContain('data-variant="banner"');
    expect(renderToStaticMarkup(result.control!)).toContain('data-variant="quiet"');
  });
});
describe("EndBlockForm embedded confirmation", () => {
  it("can open directly from the program action panel", () => {
    const html = renderToStaticMarkup(
      <EndBlockForm
        blockId="block"
        action={endAction}
        initiallyOpen
      />,
    );
    expect(html).toContain('data-testid="end-block-form"');
    expect(html).toContain('data-testid="end-block-confirm"');
    expect(html).not.toContain('data-testid="end-block-button"');
  });
});
