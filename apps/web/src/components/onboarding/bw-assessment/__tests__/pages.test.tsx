/**
 * Static-render snapshots for each BW-assessment page.
 *
 * The vitest environment is node, so we render with
 * `react-dom/server`'s `renderToStaticMarkup` and assert on coarse
 * structural markers (testids, copy fragments) rather than a full
 * HTML snapshot. This catches regressions in the page shape without
 * pinning every inline style — restyles shouldn't break the suite.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RepTestsPage } from "../RepTestsPage";
import { SkillChipsPage } from "../SkillChipsPage";
import { HingeAcknowledgementPage } from "../HingeAcknowledgementPage";

describe("RepTestsPage", () => {
  const empty = {
    pushUpMaxReps: null,
    pullUpMaxReps: null,
    squatMaxReps: null,
    plankHoldSeconds: null,
  };

  it("renders four rep-test fields", () => {
    const html = renderToStaticMarkup(
      <RepTestsPage values={empty} onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="bw-assessment-rep-tests"');
    expect(html).toContain("bw-assessment-field-pushUpMaxReps");
    expect(html).toContain("bw-assessment-field-pullUpMaxReps");
    expect(html).toContain("bw-assessment-field-squatMaxReps");
    expect(html).toContain("bw-assessment-field-plankHoldSeconds");
  });

  it("primes the user to record strict reps to failure", () => {
    const html = renderToStaticMarkup(
      <RepTestsPage values={empty} onChange={() => {}} />,
    );
    expect(html).toMatch(/strict reps to failure/i);
  });

  it("contains no external-program names (brand purity)", () => {
    const html = renderToStaticMarkup(
      <RepTestsPage values={empty} onChange={() => {}} />,
    );
    expect(html.toLowerCase()).not.toMatch(/wendler|smolov|531|stronglifts|gzcl|gvt/);
  });
});

describe("SkillChipsPage", () => {
  it("renders all 12 chips", () => {
    const html = renderToStaticMarkup(
      <SkillChipsPage selected={[]} onChange={() => {}} />,
    );
    const expected = [
      "l_sit",
      "tuck_planche",
      "tuck_front_lever",
      "tuck_back_lever",
      "pistol_squat",
      "wall_handstand",
      "freestanding_handstand",
      "muscle_up",
      "human_flag",
      "nordic_curl",
      "one_arm_push_up",
      "one_arm_pull_up",
    ];
    for (const id of expected) {
      expect(html).toContain(`bw-assessment-chip-${id}`);
    }
  });

  it("marks selected chips with data-selected=true", () => {
    const html = renderToStaticMarkup(
      <SkillChipsPage
        selected={["pistol_squat", "tuck_planche"]}
        onChange={() => {}}
      />,
    );
    expect(html).toMatch(
      /bw-assessment-chip-pistol_squat[^>]*data-selected="true"/,
    );
    expect(html).toMatch(
      /bw-assessment-chip-tuck_planche[^>]*data-selected="true"/,
    );
    expect(html).toMatch(
      /bw-assessment-chip-muscle_up[^>]*data-selected="false"/,
    );
  });
});

describe("HingeAcknowledgementPage", () => {
  it("renders the required acknowledgement checkbox", () => {
    const html = renderToStaticMarkup(
      <HingeAcknowledgementPage acknowledged={false} onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="bw-assessment-hinge-ack"');
    expect(html).toContain('data-testid="bw-assessment-hinge-ack-checkbox"');
    expect(html).toMatch(/posterior chain/i);
  });

  it("reflects the acknowledged state on the checkbox", () => {
    const onHtml = renderToStaticMarkup(
      <HingeAcknowledgementPage acknowledged={true} onChange={() => {}} />,
    );
    expect(onHtml).toContain('checked=""');
  });

  it("contains no external-program names (brand purity)", () => {
    const html = renderToStaticMarkup(
      <HingeAcknowledgementPage acknowledged={false} onChange={() => {}} />,
    );
    expect(html.toLowerCase()).not.toMatch(/wendler|smolov|531|stronglifts|gzcl/);
  });
});
