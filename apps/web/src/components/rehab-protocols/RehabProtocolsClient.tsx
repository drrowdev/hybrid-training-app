"use client";

/**
 * The rehab-protocol library UI: a list of saved protocols and an editor.
 *
 * Copy here follows the UI rule in AGENTS.md — labels and states only. The one
 * place a rule is spelled out is the delete error, because that is the one
 * place the rule stops the user.
 */
import { useMemo, useState, useTransition } from "react";
import type { RehabProtocolItem, RehabProtocolRow } from "@/lib/rehab-protocols/queries";
import { formatProtocolSummary } from "@/lib/rehab-protocols/summary";
import type { SessionLink } from "@/lib/platform/session-links";

export type PickerMovement = { id: string; name: string; pattern: string };

type SaveResult = { ok: true; syncedPrograms: string[] } | { ok: false; error: string };
type PlainResult = { ok: true } | { ok: false; error: string };

type Props = {
  protocols: RehabProtocolRow[];
  movements: PickerMovement[];
  createAction: (input: unknown) => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>;
  updateAction: (
    id: string,
    input: unknown,
  ) => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>;
  duplicateAction: (id: string) => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>;
  deleteAction: (id: string) => Promise<PlainResult>;
};

type Draft = {
  id: string | null;
  name: string;
  items: RehabProtocolItem[];
  links: SessionLink[];
};

const SIDES = [
  { value: "both", label: "Both sides" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
] as const;

export function RehabProtocolsClient({
  protocols,
  movements,
  createAction,
  updateAction,
  duplicateAction,
  deleteAction,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openNew = () => {
    setError(null);
    setNotice(null);
    setDraft({ id: null, name: "", items: [], links: [] });
  };

  const openEdit = (protocol: RehabProtocolRow) => {
    setError(null);
    setNotice(null);
    setDraft({
      id: protocol.id,
      name: protocol.name,
      items: protocol.items.map((item) => ({ ...item })),
      links: protocol.links.map((link) => ({ ...link })),
    });
  };

  const save = () => {
    if (!draft) return;
    setError(null);
    const payload = {
      name: draft.name.trim(),
      definition: { items: draft.items, links: draft.links },
    };
    startTransition(async () => {
      const result = draft.id
        ? ((await updateAction(draft.id, payload)) as unknown as SaveResult)
        : ((await createAction(payload)) as unknown as SaveResult);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const synced = result.syncedPrograms ?? [];
      setNotice(synced.length > 0 ? `Saved · ${synced.join(", ")} updated` : "Saved");
      setDraft(null);
    });
  };

  const remove = (protocol: RehabProtocolRow) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await deleteAction(protocol.id);
      if (!result.ok) setError(result.error);
    });
  };

  const duplicate = (protocol: RehabProtocolRow) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await duplicateAction(protocol.id);
      if (!result.ok) setError(result.error ?? "Couldn't copy that protocol.");
    });
  };

  if (draft) {
    return (
      <ProtocolEditor
        draft={draft}
        movements={movements}
        pending={pending}
        error={error}
        onChange={setDraft}
        onCancel={() => {
          setDraft(null);
          setError(null);
        }}
        onSave={save}
      />
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
      {notice && (
        <div
          data-testid="rehab-protocol-notice"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--cp-accent)",
            background: "var(--cp-accent-soft)",
            color: "var(--cp-accent)",
            fontSize: 13,
          }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          data-testid="rehab-protocol-error"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--cp-danger)",
            background: "var(--cp-surface)",
            color: "var(--cp-text-soft)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {protocols.length === 0 ? (
        <div
          data-testid="rehab-protocols-empty"
          style={{
            border: "1px dashed var(--cp-border-strong)",
            borderRadius: 10,
            padding: "22px 16px",
            textAlign: "center",
            background: "var(--cp-surface)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            No rehab protocols yet
          </div>
          <button type="button" className="cp-btn primary" onClick={openNew}>
            Create a protocol
          </button>
        </div>
      ) : (
        protocols.map((protocol) => (
          <section
            key={protocol.id}
            data-testid={`rehab-protocol-${protocol.id}`}
            className="cp-card"
            style={{ padding: 14, display: "grid", gap: 8 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{protocol.name}</div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 3 }}
                >
                  {formatProtocolSummary(protocol.items)}
                </div>
              </div>
            </div>

            <div>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  padding: "3px 10px",
                  borderRadius: 20,
                  border: `1px solid ${protocol.usedBy.length > 0 ? "var(--cp-accent-soft)" : "var(--cp-border)"}`,
                  color:
                    protocol.usedBy.length > 0
                      ? "var(--cp-accent)"
                      : "var(--cp-text-muted)",
                }}
              >
                {protocol.usedBy.length > 0
                  ? `Used by ${protocol.usedBy.join(", ")}`
                  : "Not in any program"}
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="cp-btn"
                disabled={pending}
                onClick={() => openEdit(protocol)}
                data-testid={`rehab-protocol-edit-${protocol.id}`}
              >
                Edit
              </button>
              <button
                type="button"
                className="cp-btn ghost"
                disabled={pending}
                onClick={() => duplicate(protocol)}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="cp-btn ghost"
                disabled={pending}
                onClick={() => remove(protocol)}
                data-testid={`rehab-protocol-delete-${protocol.id}`}
                style={{ color: "var(--cp-danger)" }}
              >
                Delete
              </button>
            </div>
          </section>
        ))
      )}

      {protocols.length > 0 && (
        <button
          type="button"
          className="cp-btn primary"
          onClick={openNew}
          disabled={pending}
          data-testid="rehab-protocol-new"
        >
          + New protocol
        </button>
      )}
    </div>
  );
}

function ProtocolEditor({
  draft,
  movements,
  pending,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  movements: PickerMovement[];
  pending: boolean;
  error: string | null;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length === 0) return movements.slice(0, 8);
    return movements
      .filter((movement) => movement.name.toLowerCase().includes(term))
      .slice(0, 12);
  }, [movements, search]);

  const setItem = (index: number, patch: Partial<RehabProtocolItem>) => {
    const items = draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...draft, items });
  };

  const addMovement = (movement: PickerMovement) => {
    onChange({
      ...draft,
      items: [
        ...draft.items,
        {
          movementId: movement.id,
          movementName: movement.name,
          side: "both",
          sets: 3,
          reps: 10,
        },
      ],
    });
    setSearch("");
  };

  const removeItem = (index: number) => {
    const removed = draft.items[index];
    const items = draft.items.filter((_, i) => i !== index);
    // A link may only name movements the protocol still contains, so dropping
    // the last row of a movement drops it from any grouping too. The server
    // rejects an orphaned link, and failing at save time would be worse.
    const stillPresent = new Set(items.map((item) => item.movementId));
    const links = removed
      ? draft.links
          .map((link) => ({
            ...link,
            members: link.members.filter((member) => stillPresent.has(member)),
          }))
          .filter((link) => link.members.length >= 2)
      : draft.links;
    onChange({ ...draft, items, links });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      {error && (
        <div
          role="alert"
          data-testid="rehab-protocol-error"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--cp-danger)",
            background: "var(--cp-surface)",
            color: "var(--cp-text-soft)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <label style={{ display: "grid", gap: 5 }}>
        <span
          style={{
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--cp-text-muted)",
          }}
        >
          Protocol name
        </span>
        <input
          value={draft.name}
          maxLength={120}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          data-testid="rehab-protocol-name"
          style={{ width: "100%", minWidth: 0 }}
        />
      </label>

      {draft.items.map((item, index) => {
        const station = draft.links.find((link) => link.members.includes(item.movementId));
        return (
          <section
            key={`${item.movementId}-${index}`}
            className="cp-card"
            data-testid={`rehab-protocol-item-${index}`}
            style={{ padding: 12, display: "grid", gap: 10 }}
          >
            {station && (
              <span
                style={{
                  justifySelf: "start",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--cp-accent)",
                  border: "1px solid var(--cp-accent-soft)",
                  borderRadius: 20,
                  padding: "2px 8px",
                }}
              >
                {station.name}
              </span>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {item.movementName}
              </span>
              <button
                type="button"
                onClick={() => removeItem(index)}
                aria-label={`Remove ${item.movementName}`}
                style={{
                  background: "none",
                  border: 0,
                  color: "var(--cp-text-muted)",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: "0 4px",
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              <NumberField
                label="Sets"
                value={item.sets}
                min={1}
                max={20}
                onChange={(value) => setItem(index, { sets: value ?? 1 })}
              />
              <NumberField
                label="Reps"
                value={item.reps}
                min={1}
                max={500}
                onChange={(value) =>
                  setItem(index, {
                    reps: value ?? undefined,
                    ...(value != null ? { holdSeconds: undefined } : {}),
                  })
                }
              />
              <NumberField
                label="Hold s"
                value={item.holdSeconds}
                min={1}
                max={3600}
                onChange={(value) =>
                  setItem(index, {
                    holdSeconds: value ?? undefined,
                    ...(value != null ? { reps: undefined } : {}),
                  })
                }
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              <label style={{ display: "grid", gap: 4 }}>
                <FieldLabel>Side</FieldLabel>
                <select
                  value={item.side ?? "both"}
                  onChange={(event) =>
                    setItem(index, { side: event.target.value as RehabProtocolItem["side"] })
                  }
                  style={{ width: "100%", minWidth: 0 }}
                >
                  {SIDES.map((side) => (
                    <option key={side.value} value={side.value}>
                      {side.label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Load kg"
                value={item.targetWeightKg}
                min={0}
                max={1000}
                step={0.5}
                onChange={(value) => setItem(index, { targetWeightKg: value ?? undefined })}
              />
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <FieldLabel>Instructions</FieldLabel>
              <input
                value={item.instructions ?? ""}
                maxLength={500}
                onChange={(event) =>
                  setItem(index, { instructions: event.target.value || undefined })
                }
                style={{ width: "100%", minWidth: 0 }}
              />
            </label>
          </section>
        );
      })}

      <section
        className="cp-card"
        style={{ padding: 12, display: "grid", gap: 8 }}
        data-testid="rehab-protocol-picker"
      >
        <label style={{ display: "grid", gap: 5 }}>
          <FieldLabel>Add a movement</FieldLabel>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            data-testid="rehab-protocol-search"
            style={{ width: "100%", minWidth: 0 }}
          />
        </label>
        <div style={{ display: "grid", gap: 5, maxHeight: 220, overflowY: "auto" }}>
          {results.map((movement) => (
            <button
              key={movement.id}
              type="button"
              onClick={() => addMovement(movement)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-bg-elevated)",
                color: "var(--cp-text)",
                font: "inherit",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{movement.name}</span>
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--cp-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  whiteSpace: "nowrap",
                }}
              >
                {movement.pattern}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="cp-btn primary"
          style={{ flex: 1 }}
          disabled={pending}
          onClick={onSave}
          data-testid="rehab-protocol-save"
        >
          {pending ? "Saving…" : "Save protocol"}
        </button>
        <button type="button" className="cp-btn ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--cp-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step ?? 1}
        value={value ?? ""}
        aria-label={label}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
        style={{ width: "100%", minWidth: 0 }}
      />
    </label>
  );
}
