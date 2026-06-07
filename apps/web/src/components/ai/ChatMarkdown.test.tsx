import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatMarkdown } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("renders ## / ### headings as heading elements (not raw hashes)", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={"## Main lifts\n### Why 1x3?"} />,
    );
    expect(html).toContain("<h3");
    expect(html).toContain("Main lifts");
    expect(html).toContain("<h4");
    expect(html).toContain("Why 1x3?");
    expect(html).not.toContain("## ");
    expect(html).not.toContain("### ");
  });

  it("renders **bold** as <strong>", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={"This is **strength-anchor** work."} />,
    );
    expect(html).toContain("<strong>strength-anchor</strong>");
    expect(html).not.toContain("**");
  });

  it("renders - bullet lists as <ul><li>", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={"- KB Swings\n- Barbell Row"} />,
    );
    expect(html).toContain("<ul");
    expect(html).toContain("<li>KB Swings</li>");
    expect(html).toContain("<li>Barbell Row</li>");
  });

  it("renders --- as a horizontal rule", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={"a\n\n---\n\nb"} />);
    expect(html).toContain("<hr");
  });

  it("does not emit raw HTML from the input (no injection)", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={"<script>alert(1)</script>"} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
