import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConditioningStep } from "./ConditioningStep";
import type { ConditioningChoice } from "@hta/domain";

function render(choices: readonly ConditioningChoice[], weekdays = [2, 5]) {
  return renderToStaticMarkup(<ConditioningStep weekdays={weekdays} choices={choices}
    onChange={() => undefined} swimmingOptions={<input aria-label="Pool length" />} />);
}

describe("conditioning step", () => {
  it("DC-SW7 uses the primary programme's weekdays without a second schedule", () => {
    const html = render([]);
    expect(html).toContain("Wednesday");
    expect(html).toContain("Saturday");
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain('href=');
  });
  it("DC-SW7 shows one shared set of swim options, only when swimming is chosen", () => {
    expect(render([])).not.toContain('aria-label="Pool length"');
    expect(render([{ weekday: 2, activity: "running" }])).not.toContain('aria-label="Pool length"');
    const html = render([{ weekday: 2, activity: "swimming" }, { weekday: 5, activity: "swimming" }]);
    expect(html.match(/aria-label="Pool length"/g)).toHaveLength(1);
    expect(html.match(/value="swimming" selected=""/g)).toHaveLength(2);
  });
  it("DC-SW5 asks to reconcile an activity after its scheduled day is removed", () => {
    const html = render([{ weekday: 5, activity: "swimming" }], [2]);
    expect(html).toContain('role="alert"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('aria-label="Pool length"');
  });
  it("preserves Sunday and Monday rather than mixing weekday conventions", () => {
    const html = render([{ weekday: 0, activity: "cycling" }, { weekday: 6, activity: "swimming" }], [6, 0]);
    expect(html.indexOf("Monday")).toBeLessThan(html.indexOf("Sunday"));
    expect(html).not.toContain("Saturday");
    expect(html).toContain('value="cycling" selected=""');
  });
  it("disables changes while the enclosing wizard saves", () => {
    const html = renderToStaticMarkup(<ConditioningStep weekdays={[2]} choices={[]} onChange={() => undefined}
      swimmingOptions={null} disabled />);
    expect(html).toMatch(/<fieldset[^>]* disabled=""/);
  });
});
