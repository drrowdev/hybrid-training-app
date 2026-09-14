import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WizardProgress } from "./WizardProgress";

describe("wizard progress", () => {
  it("supports the conditional fifth step without changing the edit-mode floor", () => {
    const html = renderToStaticMarkup(<WizardProgress
      labels={["Program", "Loadout", "Benchmarks", "Schedule", "Conditioning"]}
      current={4} first={1} furthest={4} onSelect={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toMatch(/<span[^>]*aria-current="step"[^>]*>.*Conditioning<\/span>/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Program/);
  });
  it("does not expose unvisited steps as controls", () => {
    const html = renderToStaticMarkup(<WizardProgress
      labels={["Program", "Loadout", "Benchmarks", "Schedule"]}
      current={1} first={0} furthest={1} onSelect={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).not.toContain('role="button"');
  });
});
