import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/platform/actions", () => ({
  createProgramInstance: vi.fn(),
}));

vi.mock("@/lib/training-maxes/actions", () => ({
  upsertTrainingMax: vi.fn(),
}));

import {
  ProgramPicker,
  defaultClusterFor,
  relevantBenchmarkKeysFor,
  validateClusterClient,
  toggleMultiSelect,
  type PickerProgram,
  type PickerTbTemplate,
} from "./ProgramPicker";

const OPERATOR: PickerTbTemplate = {
  id: "operator",
  name: "Operator",
  structure: "cluster",
  clusterMin: 2,
  clusterMax: 3,
  allowsBodyweightFourth: true,
  sessionsPerWeek: 3,
  defaultCluster: [
    { movement: "squat" },
    { movement: "bench" },
    { movement: "deadlift" },
  ],
};

const GLADIATOR: PickerTbTemplate = {
  id: "gladiator",
  name: "Gladiator",
  structure: "cluster",
  clusterMin: 2,
  clusterMax: 2,
  sessionsPerWeek: 3,
  defaultCluster: [{ movement: "deadlift" }, { movement: "bench" }],
};

const ZULU: PickerTbTemplate = {
  id: "zulu",
  name: "Zulu",
  structure: "split",
  clusterMin: 4,
  clusterMax: 8,
  sessionsPerWeek: 4,
  defaultCluster: [
    { movement: "squat", split: "A" },
    { movement: "press", split: "A" },
    { movement: "bench", split: "B" },
    { movement: "deadlift", split: "B" },
  ],
};

const ACTIVATION: PickerTbTemplate = {
  id: "activation",
  name: "Activation",
  structure: "cluster",
  clusterMin: 3,
  clusterMax: 3,
  sessionsPerWeek: 3,
  fixedLoadout: true,
  fixedSchedule: true,
  defaultCluster: [
    { movement: "squat" },
    { movement: "pushup", kind: "unanchored" },
    { movement: "power-clean" },
  ],
};

describe("toggleMultiSelect", () => {
  it("adds a value when absent", () => {
    expect(toggleMultiSelect([], "biceps", 2)).toEqual(["biceps"]);
    expect(toggleMultiSelect(["biceps"], "triceps", 2)).toEqual(["biceps", "triceps"]);
  });

  it("removes a value when already selected (order preserved)", () => {
    expect(toggleMultiSelect(["biceps", "triceps"], "biceps", 2)).toEqual(["triceps"]);
  });

  it("refuses to add beyond max but still allows removal", () => {
    expect(toggleMultiSelect(["biceps", "triceps"], "calves", 2)).toEqual(["biceps", "triceps"]);
    // removing an existing one is always allowed even at the cap
    expect(toggleMultiSelect(["biceps", "triceps"], "triceps", 2)).toEqual(["biceps"]);
  });

  it("treats max as unbounded when omitted", () => {
    expect(toggleMultiSelect(["a", "b", "c"], "d")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("validateClusterClient", () => {
  it("accepts the Operator default 3-lift cluster", () => {
    const v = validateClusterClient(OPERATOR, OPERATOR.defaultCluster);
    expect(v.ok).toBe(true);
    expect(v.countingLifts).toBe(3);
  });

  it("treats the optional bodyweight 4th as not counting toward the cap", () => {
    const cluster = [
      ...OPERATOR.defaultCluster,
      { movement: "pullup", kind: "bodyweight" as const },
    ];
    const v = validateClusterClient(OPERATOR, cluster);
    expect(v.ok).toBe(true);
    expect(v.countingLifts).toBe(3);
  });

  it("rejects fewer than min lifts", () => {
    const v = validateClusterClient(OPERATOR, [{ movement: "squat" }]);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/at least 2/);
  });

  it("rejects Gladiator with 3 lifts (exact 2 only)", () => {
    const v = validateClusterClient(GLADIATOR, [
      { movement: "squat" },
      { movement: "bench" },
      { movement: "deadlift" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/exactly 2/);
  });

  it("requires both A and B sides for a split template", () => {
    const v = validateClusterClient(ZULU, [
      { movement: "squat", split: "A" },
      { movement: "press", split: "A" },
      { movement: "bench", split: "A" },
      { movement: "deadlift", split: "A" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /A and a B/.test(e))).toBe(true);
  });

  it("requires >=4 lifts on a split template", () => {
    const v = validateClusterClient(ZULU, [
      { movement: "squat", split: "A" },
      { movement: "bench", split: "B" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /at least 4/.test(e))).toBe(true);
  });

  it("flags duplicate movements", () => {
    const v = validateClusterClient(OPERATOR, [
      { movement: "squat" },
      { movement: "squat" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /Duplicate/.test(e))).toBe(true);
  });

  it("accepts a valid Zulu A/B cluster", () => {
    const v = validateClusterClient(ZULU, ZULU.defaultCluster);
    expect(v.ok).toBe(true);
  });
});

describe("defaultClusterFor", () => {
  it("returns the template default when all anchors are present", () => {
    const result = defaultClusterFor(OPERATOR, ["squat", "bench", "deadlift", "press"]);
    expect(result).toEqual([
      { movement: "squat" },
      { movement: "bench" },
      { movement: "deadlift" },
    ]);
  });

  describe("relevantBenchmarkKeysFor", () => {
    const roles = [
      "squat",
      "bench",
      "deadlift",
      "press",
      "barbell-row",
      "weighted-pullup",
    ].map((engineKey) => ({
      engineKey,
      role: engineKey,
      variants: [],
    }));

    it("keeps non-TB programs on the four canonical strength benchmarks", () => {
      expect(relevantBenchmarkKeysFor(null, [], roles)).toEqual([
        "squat",
        "bench",
        "deadlift",
        "press",
      ]);
    });

    it("adds only the benchmark keys required by the active TB template", () => {
      expect(relevantBenchmarkKeysFor(
        { ...OPERATOR, requiredBenchmarkKeys: ["deadlift"] },
        [
          { movement: "bench" },
          { movement: "squat" },
          { movement: "weighted-pullup", kind: "weighted-bw" },
        ],
        roles,
      )).toEqual(["squat", "bench", "deadlift", "weighted-pullup"]);
    });
  });

  it("keeps unanchored default lifts so the benchmark step can collect them", () => {
    const result = defaultClusterFor(OPERATOR, ["squat", "bench"]);
    expect(result.map((c) => c.movement)).toEqual(["squat", "bench", "deadlift"]);
  });

  it("preserves split labels for split templates", () => {
    const result = defaultClusterFor(ZULU, ["squat", "press", "bench", "deadlift"]);
    expect(result).toEqual([
      { movement: "squat", split: "A" },
      { movement: "press", split: "A" },
      { movement: "bench", split: "B" },
      { movement: "deadlift", split: "B" },
    ]);
  });

  it("keeps a fixed phase loadout before its training maxes exist", () => {
    expect(defaultClusterFor(ACTIVATION, [])).toEqual(ACTIVATION.defaultCluster);
    expect(validateClusterClient(ACTIVATION, ACTIVATION.defaultCluster).ok).toBe(true);
  });
});

describe("ProgramPicker rendering", () => {
  const programs: PickerProgram[] = [
    {
      id: "wendler-531",
      name: "5/3/1",
      family: "wendler",
      summary: "Slow strength.",
      enabled: true,
      sessionsPerWeek: 4,
      fields: [],
    },
    {
      id: "tactical-barbell",
      name: "Tactical Barbell",
      family: "tactical-barbell",
      summary: "TB strength.",
      enabled: true,
      sessionsPerWeek: 3,
      fields: [
        {
          key: "templateId",
          label: "Template",
          type: "select",
          options: [{ value: "operator", label: "Operator" }],
          defaultValue: "operator",
        },
      ],
    },
  ];

  it("renders an info button per program card", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={programs}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[OPERATOR]}
      />,
    );
    expect(html).toContain('aria-label="About 5/3/1"');
    expect(html).toContain('aria-label="About Tactical Barbell"');
  });

  it("renders without an apostrophe-bearing JSX text node", () => {
    // Smoke test: the component should render even when the TB program is
    // selected (default), exercising the cluster-editor branch.
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={programs}
        anchoredKeys={["squat", "bench", "deadlift"]}
        tbTemplates={[OPERATOR]}
      />,
    );
    expect(html).toContain("Program");
  });

  it("starts with no program pre-selected (step 1, no Deploy button)", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={programs}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[OPERATOR]}
      />,
    );
    // The wizard opens on the Program step with the Continue (not Deploy) CTA,
    // so the deploy CTA is absent until the user advances through the wizard.
    expect(html).not.toContain("Deploy program");
    expect(html).toContain("Continue");
    // Program cards are present so the user can make a selection.
    expect(html).toContain('data-testid="program-card-wendler-531"');
  });

  it("presents Activation as a fixed 25-week phase program", () => {
    const activationPrograms = programs.map((program) =>
      program.id === "tactical-barbell"
        ? {
            ...program,
            fields: [
              {
                key: "templateId",
                label: "Template",
                type: "select" as const,
                options: [
                  { value: "operator", label: "Operator" },
                  { value: "activation", label: "Activation" },
                ],
                defaultValue: "operator",
              },
            ],
          }
        : program,
    );
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={activationPrograms}
        anchoredKeys={[]}
        tbTemplates={[OPERATOR, ACTIVATION]}
        initialProgramId="tactical-barbell"
        initialLoadoutValue="activation"
      />,
    );
    expect(html).toContain("Activation");
    expect(html).toContain("25-WEEK PROGRAM");
    expect(html).toContain("Base, Armor, Operator and Vertex");
  });
});
