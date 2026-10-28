import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MovementHistoryButton } from "../MovementHistory";

vi.mock("@/lib/sessions/movement-history-actions", () => ({ getMovementHistory: vi.fn() }));

describe("MovementHistoryButton", () => {
  it("renders a History link and keeps the sheet closed until tapped", () => {
    const html = renderToStaticMarkup(
      <MovementHistoryButton movementId="00000000-0000-4000-8000-000000000001" displayName="Bench Press (flat)" />,
    );
    expect(html).toContain('data-testid="movement-history-open"');
    expect(html).toContain("History");
    expect(html).not.toContain('data-testid="movement-history"');
  });
});
