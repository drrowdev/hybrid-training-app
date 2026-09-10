import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REHAB_PROTOCOL_MAX_NAME } from "@/lib/rehab-protocols/schema";
import { ProtocolEditor } from "../RehabProtocolsClient";

function renderEditor() {
  return renderToStaticMarkup(
    <ProtocolEditor
      draft={{
        id: null,
        name: "",
        items: [
          {
            movementId: "11111111-1111-4111-8111-111111111111",
            movementName: "Copenhagen Plank",
            sets: 3,
            reps: "8-10",
            instructions: "dynamic",
          },
        ],
        links: [],
      }}
      movements={[]}
      pending={false}
      error={null}
      onChange={vi.fn()}
      onCancel={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

describe("rehab protocol editor", () => {
  it("gives every input an explicit type so the shared field styles apply", () => {
    const inputs = renderEditor().match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(7);
    for (const input of inputs) {
      expect(input).toMatch(/\btype="(?:text|search|number)"/);
    }
    expect(inputs.filter((input) => input.includes('type="text"'))).toHaveLength(3);
    expect(inputs.filter((input) => input.includes('type="search"'))).toHaveLength(1);
  });

  it("keeps a rep range in an editable text field", () => {
    const input = renderEditor().match(/<input\b[^>]*aria-label="Reps"[^>]*>/)?.[0];
    expect(input).toContain('type="text"');
    expect(input).toContain('value="8-10"');
  });

  it("labels the required name field and uses the server's length limit", () => {
    const html = renderEditor();
    const input = html.match(/<input\b[^>]*data-testid="rehab-protocol-name"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).toContain('required=""');
    expect(input).toContain(`maxLength="${REHAB_PROTOCOL_MAX_NAME}"`);
    const id = input?.match(/\bid="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`<label for="${id}"`);
    expect(input).not.toContain("aria-invalid");
  });

  it("submits through the form while keeping other buttons from submitting", () => {
    const html = renderEditor();
    expect(html).toMatch(/^<form\b/);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    const save = buttons.find((button) => button.includes('data-testid="rehab-protocol-save"'));
    expect(save).toContain('type="submit"');
    for (const button of buttons.filter((button) => button !== save)) {
      expect(button).toContain('type="button"');
    }
  });
});
