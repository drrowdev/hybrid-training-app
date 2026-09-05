import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SplitFields } from "@/components/swim/SplitFields";

describe("DC-SW3 optional poolside split controls", () => {
  it("does not require split inputs until a swimmer adds one", () => {
    const html = renderToStaticMarkup(<SplitFields value="" onChange={() => {}} />);
    expect(html).not.toContain("<input");
    expect(html).toContain('type="button"');
  });
  it("renders existing split values as individually editable fields", () => {
    const html = renderToStaticMarkup(<SplitFields value={"4, 2:10.123\n8, 4:30"} onChange={() => {}} />);
    expect(html).toContain('aria-label="Split 1 lengths"');
    expect(html).toContain('aria-label="Split 2 time"');
    expect(html).toContain('value="2:10.123"');
    expect(html).toContain('value="8"');
    expect(html).not.toContain("<textarea");
  });
});
