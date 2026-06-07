/**
 * ChatMarkdown — a tiny, dependency-free renderer for the assistant's
 * Markdown replies (the chat bubbles previously showed raw `##` / `**`).
 *
 * The project disallows new npm deps, so this handles just the subset the
 * model actually emits — headings (#/##/###), bold (**…**), bullet lists
 * (- / *), and horizontal rules (---) — by building React elements directly.
 * It never uses `dangerouslySetInnerHTML`, so there's no XSS surface: all
 * text is rendered as React text nodes.
 */
import type { ReactNode } from "react";

/** Split a line into text + <strong> runs on `**bold**`. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ChatMarkdown({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const k = key++;
      blocks.push(
        <p key={`p${k}`} className="md-p">
          {renderInline(para.join(" "), `p${k}`)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const k = key++;
      const items = list;
      blocks.push(
        <ul key={`u${k}`} className="md-ul">
          {items.map((li, idx) => (
            <li key={`u${k}-${idx}`}>{renderInline(li, `u${k}-${idx}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) {
      flushPara();
      flushList();
      const k = key++;
      blocks.push(
        <h4 key={`h${k}`} className="md-h4">
          {renderInline(line.replace(/^###\s+/, ""), `h${k}`)}
        </h4>,
      );
    } else if (/^##\s+/.test(line) || /^#\s+/.test(line)) {
      flushPara();
      flushList();
      const k = key++;
      blocks.push(
        <h3 key={`h${k}`} className="md-h3">
          {renderInline(line.replace(/^#{1,2}\s+/, ""), `h${k}`)}
        </h3>,
      );
    } else if (/^-{3,}$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push(<hr key={`hr${key++}`} className="md-hr" />);
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="md-root">{blocks}</div>;
}
