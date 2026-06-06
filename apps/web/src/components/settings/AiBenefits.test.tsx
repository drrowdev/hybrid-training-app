import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AiBenefits } from "./AiBenefits";

describe("AiBenefits", () => {
  const html = renderToStaticMarkup(<AiBenefits />);

  it("renders the benefits card", () => {
    expect(html).toContain('data-testid="ai-benefits"');
    expect(html).toContain("Why connect your own AI?");
  });

  it("states the core capabilities", () => {
    expect(html).toContain("Ask"); // "Ask why" capability
    expect(html).toMatch(/follow-?ups/i);
    expect(html).toContain("MCP");
  });

  it("states the honest privacy posture (own key, read-only, no conversation logging)", () => {
    expect(html).toMatch(/bring your own key/i);
    expect(html).toMatch(/read-only/i);
    expect(html).toMatch(/cannot change your plan/i);
    expect(html).toMatch(/never your messages/i);
  });

  it("states the cost model (own provider, no markup)", () => {
    expect(html).toMatch(/pay your provider/i);
    expect(html).toMatch(/no markup/i);
  });
});
