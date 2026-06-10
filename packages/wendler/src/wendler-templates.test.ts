/**
 * Named program templates — catalog integrity + filter helpers.
 *
 * These assert the catalog is well-formed (every entry complete, unique ids,
 * valid cross-references) and that the filter/lookup helpers behave — so the
 * book knowledge base can't silently drift into a broken state.
 */
import { describe, it, expect } from "vitest";
import {
  WENDLER_TEMPLATES,
  LEADER_TEMPLATES,
  ANCHOR_TEMPLATES,
  STANDALONE_TEMPLATES,
  SUPPORTED_TEMPLATES,
  UNSUPPORTED_TEMPLATES,
  CNS_LOAD_RANK,
  getTemplateById,
  getTemplatesByScheme,
  getTemplatesBySupplemental,
  getTemplatesByConditioningLoad,
  sortByCnsLoad,
  RECOMMENDED_PAIRINGS,
} from "./wendler-templates";

const IDS = new Set(WENDLER_TEMPLATES.map((t) => t.id));

describe("template catalog — integrity", () => {
  it("has a non-trivial number of templates", () => {
    expect(WENDLER_TEMPLATES.length).toBeGreaterThanOrEqual(30);
  });

  it("every template id is unique", () => {
    expect(IDS.size).toBe(WENDLER_TEMPLATES.length);
  });

  it("every template carries the required, non-empty metadata", () => {
    for (const t of WENDLER_TEMPLATES) {
      expect(t.id, "id").toBeTruthy();
      expect(t.name, `${t.id} name`).toBeTruthy();
      expect(t.bookPage, `${t.id} bookPage`).toBeTruthy();
      expect(t.summary, `${t.id} summary`).toBeTruthy();
      expect(["leader", "anchor", "standalone", "seventh-week"]).toContain(t.blockKind);
      expect(["classic-531", "5s-pro", "351"]).toContain(t.mainScheme);
      expect(t.daysPerWeek.length, `${t.id} daysPerWeek`).toBeGreaterThan(0);
      expect(t.recommendedDurationBlocks.min).toBeLessThanOrEqual(t.recommendedDurationBlocks.max);
      expect(t.conditioningDaysEasy[0]).toBeLessThanOrEqual(t.conditioningDaysEasy[1]);
      expect(t.conditioningDaysHard[0]).toBeLessThanOrEqual(t.conditioningDaysHard[1]);
    }
  });

  it("pairsWith references only real template ids", () => {
    for (const t of WENDLER_TEMPLATES) {
      for (const successor of t.pairsWith ?? []) {
        expect(IDS.has(successor), `${t.id} pairsWith ${successor}`).toBe(true);
      }
    }
  });

  it("LEADER/ANCHOR/STANDALONE partition the catalog by blockKind", () => {
    expect(LEADER_TEMPLATES.every((t) => t.blockKind === "leader")).toBe(true);
    expect(ANCHOR_TEMPLATES.every((t) => t.blockKind === "anchor")).toBe(true);
    expect(STANDALONE_TEMPLATES.every((t) => t.blockKind === "standalone")).toBe(true);
    expect(LEADER_TEMPLATES.length).toBeGreaterThan(0);
    expect(ANCHOR_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("SUPPORTED + UNSUPPORTED partition by supplemental modeling", () => {
    expect(SUPPORTED_TEMPLATES.length + UNSUPPORTED_TEMPLATES.length).toBe(WENDLER_TEMPLATES.length);
    expect(SUPPORTED_TEMPLATES.every((t) => t.supplementalTemplate !== "unsupported")).toBe(true);
  });
});

describe("template catalog — anchor cornerstones exist", () => {
  it("includes the flagship Leader and Anchor templates", () => {
    expect(getTemplateById("bbb-leader")?.supplementalTemplate).toBe("bbb");
    expect(getTemplateById("5spro-fsl")?.mainScheme).toBe("5s-pro");
    expect(getTemplateById("original-531")?.mainScheme).toBe("classic-531");
    expect(getTemplateById("pr-set-fsl")?.blockKind).toBe("anchor");
  });
});

describe("template filters + helpers", () => {
  it("getTemplateById returns undefined for unknown ids", () => {
    expect(getTemplateById("does-not-exist")).toBeUndefined();
  });

  it("getTemplatesByScheme filters by main scheme", () => {
    expect(getTemplatesByScheme("5s-pro").every((t) => t.mainScheme === "5s-pro")).toBe(true);
  });

  it("getTemplatesBySupplemental filters by supplemental id", () => {
    expect(getTemplatesBySupplemental("bbb").every((t) => t.supplementalTemplate === "bbb")).toBe(true);
  });

  it("getTemplatesByConditioningLoad filters by compatibility", () => {
    const high = getTemplatesByConditioningLoad("high");
    expect(high.every((t) => t.conditioningCompatibility === "high")).toBe(true);
  });

  it("sortByCnsLoad orders ascending by default and descending on request", () => {
    const asc = sortByCnsLoad();
    for (let i = 1; i < asc.length; i++) {
      expect(CNS_LOAD_RANK[asc[i]!.cnsLoad]).toBeGreaterThanOrEqual(CNS_LOAD_RANK[asc[i - 1]!.cnsLoad]);
    }
    const desc = sortByCnsLoad(undefined, "desc");
    for (let i = 1; i < desc.length; i++) {
      expect(CNS_LOAD_RANK[desc[i]!.cnsLoad]).toBeLessThanOrEqual(CNS_LOAD_RANK[desc[i - 1]!.cnsLoad]);
    }
  });
});

describe("recommended Leader → Anchor pairings", () => {
  it("reference real templates of the correct kind", () => {
    expect(RECOMMENDED_PAIRINGS.length).toBeGreaterThan(0);
    for (const p of RECOMMENDED_PAIRINGS) {
      expect(getTemplateById(p.leader)?.blockKind, `${p.leader} is a leader`).toBe("leader");
      expect(getTemplateById(p.anchor)?.blockKind, `${p.anchor} is an anchor`).toBe("anchor");
    }
  });
});
