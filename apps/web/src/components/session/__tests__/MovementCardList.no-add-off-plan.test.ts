/**
 * Regression guard for the "+ Add off-plan movement" unification
 * (issue #210). After the fix, `MovementCardList` no longer owns its
 * own add-movement entry point — that surface moved entirely to the
 * page-level `<AddToWorkout>` pill.
 *
 * If a future refactor re-introduces the inline picker / its
 * `addSessionMovementAction` import, this test fails so we catch the
 * duplicate before users see two "Add" buttons again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOVEMENT_CARD_LIST = resolve(HERE, "..", "MovementCardList.tsx");
const SESSION_WORK_AREA = resolve(HERE, "..", "SessionWorkArea.tsx");

describe("MovementCardList — single Add entry point", () => {
  const list = readFileSync(MOVEMENT_CARD_LIST, "utf8");
  const workArea = readFileSync(SESSION_WORK_AREA, "utf8");

  it("does not render the inline '+ Add off-plan movement' button", () => {
    expect(list).not.toMatch(/movement-card-add/);
    expect(list).not.toMatch(/\+\s*Add off-plan movement/);
  });

  it("does not import addSessionMovementAction (owned by AddToWorkout)", () => {
    expect(list).not.toMatch(/addSessionMovementAction/);
    expect(list).not.toMatch(/from\s+"@\/components\/movement-picker"/);
  });

  it("does not import or reference the deleted AddOffPlanMovement component", () => {
    expect(list).not.toMatch(/AddOffPlanMovement/);
    expect(workArea).not.toMatch(/AddOffPlanMovement/);
  });

  it("drops the hideAddOffPlan prop from both surfaces", () => {
    expect(list).not.toMatch(/hideAddOffPlan/);
    expect(workArea).not.toMatch(/hideAddOffPlan/);
  });
});
