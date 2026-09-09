import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SwimHub } from "@/components/swim/SwimHub";
import { nextConfirmedView, nextSwimHubView, type SwimHubView } from "../view-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("../actions", () => ({}));

function view(revision: number, status: SwimHubView["status"] = "active", id = "selected"): SwimHubView {
  return {
    id, revision, status, goal: "Technique & base", course: "25 yd",
    dates: "2026-09-07 – 2026-10-31", today: "2026-09-08",
    workouts: [{
      id: "workout", date: "2026-10-15", title: "Easy swim", total: "300 yd",
      status: status === "active" ? "Scheduled" : "Unscheduled", week: 1, provisional: false,
    }],
    proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
  };
}

describe("DC-SW7 monotonic swim hub view", () => {
  it("retains the Hub export as the same generic policy, not a divergent reducer", () => {
    expect(nextSwimHubView).toBe(nextConfirmedView);
  });

  it.each(["props", "confirmed"] as const)("accepts a higher same-plan revision from %s", (source) => {
    const current = view(3);
    const incoming = view(4, "paused");
    expect(nextSwimHubView(current, incoming, source)).toBe(incoming);
  });

  it.each(["props", "confirmed"] as const)("retains current identity for a lower revision from %s", (source) => {
    const current = view(5);
    expect(nextSwimHubView(current, view(4, "paused"), source)).toBe(current);
  });

  it("accepts equal-revision props including changed workout data, but not equal confirmed replies", () => {
    const current = view(4);
    const incoming = { ...view(4), workouts: [{ ...current.workouts[0]!, status: "Completed" }] };
    expect(nextSwimHubView(current, incoming, "props")).toBe(incoming);
    expect(nextSwimHubView(current, incoming, "confirmed")).toBe(current);
    expect(nextSwimHubView(current, current, "props")).toBe(current);
  });

  it.each([1, 4, 9])("only props can select a different plan at revision %s", (revision) => {
    const current = view(4);
    const incoming = view(revision, "paused", "other");
    expect(nextSwimHubView(current, incoming, "props")).toBe(incoming);
    expect(nextSwimHubView(current, incoming, "confirmed")).toBe(current);
  });

  it("absorbs confirmed4 → props5 → props3 and rejects late confirmed4", () => {
    const confirmed4 = view(4, "paused");
    const props5 = view(5, "finished");
    let held = nextSwimHubView(view(3), confirmed4, "confirmed");
    expect(held).toBe(confirmed4);
    held = nextSwimHubView(held, props5, "props");
    expect(held).toBe(props5);
    held = nextSwimHubView(held, view(3), "props");
    expect(held).toBe(props5);
    expect(nextSwimHubView(held, confirmed4, "confirmed")).toBe(props5);
  });

  it("ignores an old plan's late reply after props select a new plan", () => {
    const selected = view(1, "paused", "other");
    const held = nextSwimHubView(view(5), selected, "props");
    expect(nextSwimHubView(held, view(6, "archived"), "confirmed")).toBe(selected);
  });
});

describe("DC-SW7 lifecycle controls and parent navigation SSR", () => {
  const selectedChoice = { id: "selected", startedOn: "2026-09-07", status: "active" as const };
  const otherChoice = { id: "other", startedOn: "2026-08-01", status: "archived" as const };

  it.each([
    ["active", true, true, false, true, true, false],
    ["paused", false, false, true, true, true, true],
    ["finished", false, false, false, false, true, true],
    ["archived", false, false, false, false, false, true],
  ] as const)("%s renders one coherent set of controls", (status, review, pause, resume, finish, archive, setup) => {
    const plan = nextSwimHubView(view(1), view(2, status), "confirmed");
    const html = renderToStaticMarkup(<SwimHub plan={plan} plans={[selectedChoice, otherChoice]} setupEnabled />);
    expect(html.match(/data-testid="page-header"/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('href="/app/plan"');
    expect(html.includes(">Review next week</button>")).toBe(review);
    expect(html.includes(">Pause</button>")).toBe(pause);
    expect(html.includes('name="startDate"')).toBe(resume);
    expect(html.includes(">Preview dates</button>")).toBe(resume);
    expect(html.includes(">Finish plan</button>")).toBe(finish);
    expect(html.includes(">Archive</button>")).toBe(archive);
    expect(html.includes('href="/app/swim/setup"')).toBe(setup);
    expect(html.includes(">Review assessment</button>")).toBe(status === "active" || status === "paused");
    expect(html).toContain('href="/app/swim/workout"');
    expect(html).toContain("2026-10-15");
    expect(html).toContain(status === "active" ? "Scheduled" : "Unscheduled");
    const navigation = html.match(/<nav\b[^>]*aria-label="Swim plans"[^>]*>.*?<\/nav>/)?.[0];
    expect(navigation).toContain(`2026-09-07 · ${{ active: "Active", paused: "Paused", finished: "Finished", archived: "Archived" }[status]}`);
    expect(navigation).toContain("2026-08-01 · Archived");
    expect(navigation?.match(/aria-current="page"/g)).toHaveLength(1);
    const selectedLink = navigation?.match(/<a\b[^>]*href="\/app\/swim\?plan=selected"[^>]*>/)?.[0];
    expect(selectedLink).toContain('aria-current="page"');
    expect(navigation!.indexOf("?plan=selected")).toBeLessThan(navigation!.indexOf("?plan=other"));
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<nav"));
    expect(html.indexOf("</nav>")).toBeLessThan(html.indexOf("<section"));
  });

  describe("DC-SW7 Hub request wiring (source, not browser interaction)", () => {
    it("uses the same lazy per-instance gate for all dispatches and all disabled controls", () => {
      const source = readFileSync(new URL("../../../components/swim/SwimHub.tsx", import.meta.url), "utf8");
      expect(source).toContain("const [requestGate] = useState(createRequestGate)");
      expect(source.match(/void requestGate\(async \(\) => \{/g)).toHaveLength(3);
      expect(source.match(/}, setRequestBusy\)/g)).toHaveLength(3);
      expect(source.match(/disabled=\{requestBusy\}/g)).toHaveLength(12);
      expect(source).not.toMatch(/useTransition|startTransition|disabled=\{pending\}|router\.refresh|useRouter/);
      const paths = source.split("void requestGate(async () => {").slice(1);
      expect(paths[0]).toContain("await action()");
      expect(paths[1]).toContain("await proposeSwimBenchmark(");
      expect(paths[2]).toContain("await previewSwimResume(");
      for (const path of paths) {
        expect(path).toContain("setError(null)");
        expect(path).toContain("catch { setError(");
      }
      expect(paths[0]).toContain('nextSwimHubView(current, view, "confirmed")');
      expect(paths[0]).toContain("setPreview(null)");
      expect(paths[0]).toContain("setBenchmark(null)");
      expect(source).toContain("[result.warning, result.refreshWarning]");
      expect(source).toContain('warnings.map((warning, index) => <p key={index} role="status" className={styles.warning}>{warning}</p>)');
      expect(source.match(/setWarnings\(\[\]\)/g)).toHaveLength(1);
    });
  });

  it.each(["paused", "finished", "archived"] as const)("does not offer setup for %s while another own plan is active", (status) => {
    const html = renderToStaticMarkup(<SwimHub plan={view(2, status)}
      plans={[selectedChoice, { ...otherChoice, status: "active" }]} setupEnabled />);
    expect(html).not.toContain('href="/app/swim/setup"');
    expect(html).toContain("2026-08-01 · Active");
  });

  it("keeps setup disabled and single-plan navigation hidden", () => {
    const html = renderToStaticMarkup(<SwimHub plan={view(2, "paused")} plans={[selectedChoice]} setupEnabled={false} />);
    expect(html).not.toContain('href="/app/swim/setup"');
    expect(html).not.toContain('aria-label="Swim plans"');
    expect(html).toContain('name="startDate"');
  });

  it("restores active controls and hides setup on confirmed resume despite paused choices", () => {
    const plan = nextSwimHubView(view(3, "paused"), view(4), "confirmed");
    const html = renderToStaticMarkup(<SwimHub plan={plan}
      plans={[{ ...selectedChoice, status: "paused" }, otherChoice]} setupEnabled />);
    expect(html).toContain(">Pause</button>");
    expect(html).toContain("2026-09-07 · Active");
    expect(html).not.toContain('name="startDate"');
    expect(html).not.toContain('href="/app/swim/setup"');
  });
});
