import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingWizard } from "../OnboardingWizard";
import { HOME_GYM_PRESET } from "@/lib/settings/equipment-presets";
import { needsOnboarding } from "@/lib/onboarding/gate";

const harness = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, task: undefined as Promise<void> | undefined,
  push: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push, refresh: harness.refresh }) }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
    return [harness.states[index], (next: unknown) => {
      harness.states[index] = typeof next === "function" ? next(harness.states[index]) : next;
    }];
  },
  useTransition: () => [false, (fn: () => Promise<void>) => { harness.task = fn(); }],
}));
vi.mock("@/components/onboarding/EquipmentStep", () => ({ EquipmentStep: () => null }));
vi.mock("@/components/settings/CardioModalitySettings", () => ({ CardioModalitySettings: () => null }));
vi.mock("@/components/onboarding/bw-assessment/BwAssessmentStep", () => ({ BwAssessmentStep: () => null }));

function buttons(node: React.ReactNode): React.ReactElement<{ children?: React.ReactNode; onClick?: () => void; disabled?: boolean }>[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [
    ...(node.type === "button" ? [node] : []),
    ...React.Children.toArray(node.props.children).flatMap(buttons),
  ];
}
function wizard(swimHref: string | null) {
  const saveProfileAction = vi.fn(async () => ({ ok: true as const }));
  const saveEquipmentAction = vi.fn(async () => {});
  const saveTmsAction = vi.fn(async () => ({ ok: true as const }));
  const submitBwAssessmentAction = vi.fn(async () => ({ ok: true as const }));
  const finishAction = vi.fn(async () => ({ ok: true as const }));
  const props = {
    swimHref, initialDisplayName: "", initialUnits: "metric" as const, initialBodyweightKg: null,
    initialEquipment: HOME_GYM_PRESET, hasEquipmentRow: false, initialCardioModalities: [],
    roleCandidates: [], saveProfileAction, saveEquipmentAction, saveTmsAction, submitBwAssessmentAction,
    finishAction, skipAction: async () => {},
  };
  const tree = () => { harness.cursor = 0; return OnboardingWizard(props); };
  return {
    props,
    html: () => renderToStaticMarkup(tree()),
    async click(label: string) {
      const button = buttons(tree()).find((entry) => entry.props.children === label);
      expect(button).toBeDefined();
      expect(button!.props.disabled).not.toBe(true);
      button!.props.onClick!();
      await harness.task;
    },
  };
}
beforeEach(() => { harness.states = []; harness.cursor = 0; harness.task = undefined; vi.clearAllMocks(); });
describe("DC-SW7 fresh swimming onboarding", () => {
  it("completes common profile without strength equipment, training maxes or assessment", async () => {
    const flow = wizard("/app/swim/setup");
    await flow.click("Swimming");
    await flow.click("Continue →");
    expect(flow.html()).not.toContain("onboarding-experience-");
    await flow.click("Set up swimming →");
    expect(flow.props.saveProfileAction).toHaveBeenCalledOnce();
    expect(flow.props.finishAction).toHaveBeenCalledOnce();
    expect(flow.props.saveEquipmentAction).not.toHaveBeenCalled();
    expect(flow.props.saveTmsAction).not.toHaveBeenCalled();
    expect(flow.props.submitBwAssessmentAction).not.toHaveBeenCalled();
    expect(harness.push).toHaveBeenCalledWith("/app/swim/setup");
    expect(harness.refresh).toHaveBeenCalledOnce();
    expect(needsOnboarding({ hasAnyTm: false, onboardedAt: "2026-09-11T12:00:00Z" })).toBe(false);
  });
  it("retains the strength steps and experience gate when swimming is unavailable", async () => {
    const flow = wizard(null);
    expect(flow.html()).not.toContain(">Swimming</button>");
    await flow.click("Continue →");
    expect(flow.html()).toContain("onboarding-experience-");
    expect(flow.html()).toContain("Training maxes");
    expect(flow.props.finishAction).not.toHaveBeenCalled();
    expect(harness.push).not.toHaveBeenCalled();
  });
});
