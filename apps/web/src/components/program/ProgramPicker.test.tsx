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
  activationSummaryPhaseFor,
  activationRequiredBenchmarkKeysFor,
  defaultClusterFor,
  initialRehabByDay,
  relevantBenchmarkKeysFor,
  startScheduleFor,
  validateClusterClient,
  toggleMultiSelect,
  type PickerProgram,
  type PickerTbTemplate,
} from "./ProgramPicker";
import { hybridProgramEngine } from "@/lib/programs/hybrid/engine";

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

// What the server sends per slot (verified against `tbSlotDose` for Zulu).
const MAIN_DOSE = { sets: "3–5", reps: "3–8", load: "70–85% TM" };
const SUPP_DOSE = { sets: "3–5", reps: "8–10", load: "65–75% TM" };

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

const ZULU_TB3: PickerTbTemplate = {
  ...ZULU,
  fixedLoadout: true,
  sessionSeries: [
    {
      key: "slot-1",
      label: "Day 1 \u00B7 A",
      slots: [
        { sourceMovement: "bench", role: "main", dose: MAIN_DOSE },
        { sourceMovement: "squat", role: "main", dose: MAIN_DOSE },
        { sourceMovement: "overhead-press", role: "supplemental", dose: SUPP_DOSE },
        {
          sourceMovement: "hanging-leg-raise",
          role: "supplemental",
          kind: "unanchored",
        },
        {
          sourceMovement: "hanging-knee-raise",
          role: "supplemental",
          kind: "unanchored",
        },
        {
          sourceMovement: "toes-to-bar",
          role: "supplemental",
          kind: "unanchored",
        },
      ],
    },
    {
      key: "slot-2",
      label: "Day 2 \u00B7 B",
      slots: [
        { sourceMovement: "deadlift", role: "main" },
        { sourceMovement: "weighted-pullup", role: "main", kind: "weighted-bw" },
        { sourceMovement: "barbell-row", role: "supplemental" },
        {
          sourceMovement: "back-extension",
          role: "supplemental",
          kind: "unanchored",
        },
      ],
    },
  ],
};

const ACTIVATION: PickerTbTemplate = {  id: "activation",
  name: "Activation",
  structure: "cluster",
  clusterMin: 3,
  clusterMax: 3,
  sessionsPerWeek: 3,
  fixedLoadout: true,
  fixedSchedule: true,
  startSchedules: [
    {
      startWeekIndex: 0,
      label: "Base",
      strength: 3,
      cardio: 3,
      rest: 1,
    },
    {
      startWeekIndex: 5,
      label: "Armor",
      strength: 4,
      cardio: 2,
      rest: 1,
    },
  ],
  defaultCluster: [
    { movement: "squat" },
    { movement: "pushup", kind: "unanchored" },
    { movement: "power-clean" },
  ],
};

describe("activationSummaryPhaseFor", () => {
  it("uses the absolute current program week while editing", () => {
    expect(
      activationSummaryPhaseFor(0, {
        currentWeekIndex: 5,
        programStartWeekIndex: 0,
      }),
    ).toBe("armor");
    expect(
      activationSummaryPhaseFor(0, {
        currentWeekIndex: 3,
        programStartWeekIndex: 5,
      }),
    ).toBe("operator");
  });

  it("uses the selected start point for a new program", () => {
    expect(activationSummaryPhaseFor(0)).toBe("base");
    expect(activationSummaryPhaseFor(21)).toBe("vertex");
  });

  it("uses the next editable phase during a protected milestone week", () => {
    expect(
      activationSummaryPhaseFor(0, {
        currentWeekIndex: 4,
        programStartWeekIndex: 0,
      }),
    ).toBe("armor");
    expect(
      activationSummaryPhaseFor(0, {
        currentWeekIndex: 19,
        programStartWeekIndex: 0,
      }),
    ).toBe("vertex");
  });
});

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

  describe("activationRequiredBenchmarkKeysFor", () => {
    it("lets Base and its test week establish the later maxes", () => {
      expect(activationRequiredBenchmarkKeysFor(0)).toEqual([]);
      expect(activationRequiredBenchmarkKeysFor(4)).toEqual([]);
    });

    it("requires the exact loaded Armor movements for a direct Armor start", () => {
      // Supplemental A (back extension / reverse hyper) is prescribed by effort,
      // not off a max, so it is deliberately absent.
      expect(activationRequiredBenchmarkKeysFor(5)).toEqual([
        "squat",
        "bench",
        "deadlift",
        "barbell-row",
        "rack-pull",
        "overhead-press",
      ]);
    });
  });

  describe("startScheduleFor", () => {
    it("returns the selected Activation phase schedule", () => {
      expect(startScheduleFor(ACTIVATION, 5)).toEqual({
        startWeekIndex: 5,
        label: "Armor",
        strength: 4,
        cardio: 2,
        rest: 1,
      });
    });

    it("returns null when a template has no phase schedule", () => {
      expect(startScheduleFor(OPERATOR, 0)).toBeNull();
    });
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

  it("offers customization for a standalone TB template", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={programs}
        anchoredKeys={["squat", "bench", "deadlift"]}
        tbTemplates={[OPERATOR]}
        initialProgramId="tactical-barbell"
      />,
    );
    expect(html).toContain("Customize template");
    expect(html).toContain(
      "Move strength and conditioning, add rehab-only days",
    );
  });

  const zuluPrograms = (): PickerProgram[] =>
    programs.map((program) =>
      program.id === "tactical-barbell"
        ? {
            ...program,
            fields: [
              {
                key: "templateId",
                label: "Template",
                type: "select" as const,
                options: [{ value: "zulu", label: "Zulu" }],
                defaultValue: "zulu",
              },
            ],
          }
        : program,
    );

  const ACCESSORY_LIBRARY = [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      name: "Barbell Curl",
      slug: "bb-curl",
      pattern: "isolation",
      hasOneRm: false,
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      name: "Farmer Carry",
      slug: "farmer-carry",
      pattern: "carry",
      hasOneRm: false,
    },
  ];

  it("shows each Zulu session's main and supplemental lifts on the loadout step", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
      />,
    );

    expect(html).toContain('data-testid="tb-session-preview"');
    expect(html).toContain("Supplemental");
    for (const lift of [
      "Overhead Press",
      "Barbell Row",
      "Back Extension",
      "Weighted Pull-up",
    ]) {
      expect(html).toContain(lift);
    }
    // The ab work is one circuit, so it reads as one entry.
    expect(html).toContain("AB Triad");
    expect(html).not.toContain("Hanging Knee Raise");
  });

  const REHAB_LIBRARY = [
    {
      id: "bbbbbbbb-0000-4000-8000-000000000001",
      name: "TB Zulu rehab",
      summary: "3 movements",
      items: [
        {
          movementId: "cccccccc-0000-4000-8000-000000000001",
          movementName: "Copenhagen Plank",
          sets: 3,
          holdSeconds: 30,
        },
      ],
      links: [],
    },
    {
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      name: "Shoulder prehab",
      summary: "2 movements",
      items: [
        {
          movementId: "cccccccc-0000-4000-8000-000000000002",
          movementName: "Prone Y",
          sets: 2,
          reps: 12,
        },
      ],
      links: [],
    },
  ];

  it("offers rehab on every session card once the library has a protocol", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
        libraryProtocols={REHAB_LIBRARY}
      />,
    );

    expect(html).toContain('data-testid="tb-add-rehab-slot-1"');
    expect(html).toContain('data-testid="tb-add-rehab-slot-2"');
    // Every protocol is offered on every card, so two sessions can run
    // different ones.
    expect(html).toContain("TB Zulu rehab");
    expect(html).toContain("Shoulder prehab");
  });

  it("offers no rehab control when the library is empty", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
      />,
    );

    expect(html).not.toContain('data-testid="tb-add-rehab-slot-1"');
  });

  it("shows each session's own protocol when re-entering the wizard", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
        libraryProtocols={REHAB_LIBRARY}
        existingRehabBindings={{
          "bbbbbbbb-0000-4000-8000-000000000001": "protocol-1",
          "bbbbbbbb-0000-4000-8000-000000000002":
            "bbbbbbbb-0000-4000-8000-000000000002",
        }}
        editContext={{
          blockId: "11111111-1111-4111-8111-111111111111",
          programId: "tactical-barbell",
          setupValues: { templateId: "zulu" },
          strengthWeekdays: [0, 1, 3, 4],
          cardioWeekdays: [],
          startedOn: "2026-01-05",
          accessoriesEnabled: false,
          rehabSchedule: {
            version: 1,
            protocols: [
              {
                id: "protocol-1",
                name: "TB Zulu rehab",
                items: REHAB_LIBRARY[0]!.items,
              },
              {
                id: "bbbbbbbb-0000-4000-8000-000000000002",
                name: "Shoulder prehab",
                items: REHAB_LIBRARY[1]!.items,
              },
            ],
            series: [
              { key: "slot-1", protocolId: "protocol-1" },
              {
                key: "slot-2",
                protocolId: "bbbbbbbb-0000-4000-8000-000000000002",
              },
            ],
            days: [],
          } as never,
        }}
      />,
    );

    expect(html).toContain('data-testid="tb-rehab-slot-1"');
    expect(html).toContain('data-testid="tb-rehab-remove-slot-1"');
    expect(html).toContain('data-testid="tb-rehab-slot-2"');
    // Neither session offers to add rehab it already has.
    expect(html).not.toContain('data-testid="tb-add-rehab-slot-1"');
  });

  it("keeps a pre-envelope block's rehab day set when re-entering the wizard", () => {
    // A block deployed before the envelope existed keeps its rehab day in
    // `dayTypes` and its protocol under the synthetic legacy id. Losing it here
    // would strand the wizard: the day would read as unset and refuse to deploy
    // until the user re-picked what the block already runs.
    const legacyBlock = {
      version: 1,
      displayName: "TB Zulu rehab",
      dayTypes: [
        "strength",
        "strength",
        "rehab",
        "strength",
        "strength",
        "rest",
        "rest",
      ],
      sessionMovements: {},
      rehab: { items: REHAB_LIBRARY[0]!.items },
    } as never;
    const bindings = new Map([["protocol-1", REHAB_LIBRARY[0]!.id]]);

    expect(initialRehabByDay(undefined, legacyBlock, bindings)).toEqual({
      2: REHAB_LIBRARY[0]!.id,
    });
    // With no binding there is nothing to seed — the day stays unset rather
    // than guessing a protocol.
    expect(initialRehabByDay(undefined, legacyBlock, new Map())).toEqual({});
  });

  it("reads rehab days from the envelope once a block has one", () => {
    const envelope = {
      version: 1,
      protocols: [
        { id: "protocol-1", name: "TB Zulu rehab", items: REHAB_LIBRARY[0]!.items },
      ],
      series: [],
      days: [{ day: 5, protocolId: "protocol-1" }],
    } as never;
    const bindings = new Map([["protocol-1", REHAB_LIBRARY[0]!.id]]);

    expect(initialRehabByDay(envelope, undefined, bindings)).toEqual({
      5: REHAB_LIBRARY[0]!.id,
    });
  });

  it("lets every Zulu slot be changed or removed from the loadout step", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
      />,
    );

    for (const slot of ["bench", "squat", "overhead-press"]) {
      expect(html).toContain(`data-testid="tb-slot-slot-1-${slot}"`);
      expect(html).toContain(`data-testid="tb-slot-change-slot-1-${slot}"`);
    }
    // The triad is one row, so it can't be half-removed — but it can be swapped.
    expect(html).toContain('data-testid="tb-slot-slot-1-ab-triad"');
    expect(html).toContain('data-testid="tb-slot-change-slot-1-ab-triad"');
    expect(html).not.toContain("tb-slot-change-slot-1-hanging-leg-raise");
  });

  it("groups a session's lifts under the section each is run in", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
      />,
    );
    const card = html.slice(
      html.indexOf('data-testid="tb-slot-slot-1-bench"') - 400,
      html.indexOf('data-testid="tb-slot-slot-2-deadlift"'),
    );

    expect(card.indexOf("Main lifts")).toBeGreaterThanOrEqual(0);
    expect(card.indexOf("Main lifts")).toBeLessThan(card.indexOf("Supplemental"));
    expect(card.indexOf("Supplemental")).toBeLessThan(
      card.indexOf("Overhead Press"),
    );
  });

  it("does not head a session that is nothing but main lifts", () => {
    const operatorPrograms: PickerProgram[] = programs.map((program) =>
      program.id === "tactical-barbell"
        ? {
            ...program,
            fields: [
              {
                key: "templateId",
                label: "Template",
                type: "select" as const,
                options: [{ value: "operator", label: "Operator" }],
                defaultValue: "operator",
              },
            ],
          }
        : program,
    );
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={operatorPrograms}
        anchoredKeys={["squat", "bench", "deadlift"]}
        tbTemplates={[
          {
            ...OPERATOR,
            sessionSeries: [
              {
                key: "slot-1",
                label: "Day 1",
                slots: [
                  { sourceMovement: "bench", role: "main" },
                  { sourceMovement: "squat", role: "main" },
                ],
              },
            ],
          },
        ]}
        initialProgramId="tactical-barbell"
      />,
    );

    expect(html).toContain('data-testid="tb-slot-slot-1-bench"');
    expect(html).not.toContain("Main lifts");
    expect(html).not.toContain("Supplemental");
  });

  it("offers the whole library from one add button", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        rehabMovements={ACCESSORY_LIBRARY}
        initialProgramId="tactical-barbell"
      />,
    );
    const start = html.indexOf('data-testid="tb-add-exercise-slot-1"');
    const scoped = html.slice(start, html.indexOf("</details>", start));

    // One picker, so a carry is reachable — it just can't be ACCESSORY work,
    // which the work-type step states when you pick it.
    expect(scoped).toContain("Barbell Curl");
    expect(scoped).toContain("Farmer Carry");
    expect(html).not.toContain('data-testid="tb-add-accessory-slot-1"');
    expect(html).not.toContain('data-testid="tb-add-supplemental-slot-1"');
  });

  it("states what each row will be prescribed", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        rehabMovements={ACCESSORY_LIBRARY}
        initialProgramId="tactical-barbell"
      />,
    );
    // Two add buttons differing only by an invisible dose was the complaint;
    // the row is where that becomes visible.
    const start = html.indexOf('data-testid="tb-dose-slot-1-squat"');
    expect(start).toBeGreaterThan(-1);
    expect(html.slice(start, start + 120)).toContain("3–5 × 3–8 · 70–85% TM");
    const supp = html.indexOf('data-testid="tb-dose-slot-1-overhead-press"');
    expect(html.slice(supp, supp + 120)).toContain("3–5 × 8–10 · 65–75% TM");
    // The circuit states its own shape rather than a sets × reps line.
    const triad = html.indexOf('data-testid="tb-dose-slot-1-ab-triad"');
    expect(html.slice(triad, triad + 80)).toContain("3 rounds × 5");
  });

  it("no longer offers the Tactical Barbell accessory toggle", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={zuluPrograms()}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[ZULU_TB3]}
        initialProgramId="tactical-barbell"
      />,
    );

    expect(html).not.toContain('data-testid="tb-accessories-toggle"');
    expect(html).not.toContain("tb-accessory-muscle-");
  });

  it("no longer offers the Green Protocol accessory toggle", () => {
    const greenPrograms: PickerProgram[] = [
      {
        id: "green-protocol",
        name: "Green Protocol",
        family: "green",
        summary: "Endurance-led Tactical Barbell.",
        enabled: true,
        sessionsPerWeek: 5,
        fixedSchedule: true,
        fields: [
          {
            key: "phaseId",
            label: "Phase",
            type: "select" as const,
            options: [{ value: "base", label: "Base Building" }],
            defaultValue: "base",
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={greenPrograms}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[]}
        initialProgramId="green-protocol"
      />,
    );

    expect(html).not.toContain('data-testid="tb-accessories-toggle"');
    expect(html).not.toContain("tb-accessory-muscle-");
  });

  it("offers a per-block assistance volume on the 5/3/1 loadout step, defaulting to Balanced", () => {    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={programs}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[OPERATOR]}
        initialProgramId="wendler-531"
      />,
    );
    expect(html).toContain('data-testid="wendler-assistance-volume"');
    for (const level of ["low", "standard", "high"]) {
      expect(html).toContain(`data-testid="wendler-assistance-volume-${level}"`);
    }
    // Balanced is pre-selected; the other two are not.
    expect(html).toMatch(
      /data-testid="wendler-assistance-volume-standard"[^>]*aria-pressed="true"/,
    );
    expect(html).toMatch(
      /data-testid="wendler-assistance-volume-low"[^>]*aria-pressed="false"/,
    );
  });

  it("does not offer assistance volume for a non-5/3/1 program", () => {
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={programs}
        anchoredKeys={["squat", "bench", "deadlift"]}
        tbTemplates={[OPERATOR]}
        initialProgramId="tactical-barbell"
      />,
    );
    expect(html).not.toContain('data-testid="wendler-assistance-volume"');
  });

  it("surfaces every Hybrid setup field in the loadout step, including accessory volume", () => {
    // Hybrid has no template list, so its Loadout step renders the engine's
    // own `describeSetup()` fields generically. This is the guard against the
    // exact failure this test file's subject had: an engine-side lever that
    // exists, validates and materialises, but that no screen ever offers.
    const hybrid: PickerProgram = {
      id: "hybrid",
      name: "Hybrid",
      family: "hybrid",
      summary: "Concurrent strength + cardio.",
      enabled: true,
      sessionsPerWeek: 4,
      fields: hybridProgramEngine.describeSetup().fields,
    };
    const html = renderToStaticMarkup(
      <ProgramPicker
        programs={[hybrid]}
        anchoredKeys={["squat", "bench", "deadlift", "press"]}
        tbTemplates={[OPERATOR]}
        initialProgramId="hybrid"
      />,
    );
    expect(html).toContain("Accessory volume");
    for (const label of [
      "Minimal — main lifts and essentials only",
      "Balanced (recommended)",
      "More — extra muscle-building work",
    ]) {
      expect(html).toContain(label);
    }
    // Medium is pre-selected from the schema default.
    expect(html).toMatch(/<option[^>]*value="medium"[^>]*selected/);
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
    expect(html).toContain("Armor supplemental clusters");
    expect(html).toContain("Back Extensions + AB Triad");
    expect(html).toContain("Reverse Hyper + AB Triad");
    expect(html).toContain("Pull-ups + Overhead Press");
    expect(html).toContain("Inverted Rows + Overhead Press");
    expect(html).toContain("Customize template");
    expect(html).toContain(
      "Customize each Activation phase while keeping its progression",
    );
  });
});
