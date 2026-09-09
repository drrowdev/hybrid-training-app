import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../../../../../../packages/db/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, directory), "utf8");
const up = read("drizzle/0147_shared_completion_identity.sql");
const down = read("rollbacks/0147_shared_completion_identity.down.sql");
const baseline = read("drizzle/0144_atomic_user_workflows.sql");
const identity = read("drizzle/0146_swim_request_identity.sql");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const shared = "public.complete_training_session_with_transition(uuid, text, uuid)";
const helper = "public.swim_request_user_id()";

function definition(source: string) {
  const matches = [...source.matchAll(
    /CREATE (?:OR REPLACE )?FUNCTION public\.complete_training_session_with_transition\([\s\S]*?\$\$;/g,
  )];
  expect(matches).toHaveLength(1);
  return matches[0]![0].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
}

function body(source: string) {
  return definition(source).split("AS $$")[1]!.slice(0, -3);
}

function guard(source: string) {
  return source.slice(source.indexOf("DO $migration$"), source.indexOf("    IF v_phase = 0 THEN"));
}

const diagnosticRaises = /RAISE EXCEPTION USING MESSAGE = 'SCID\/'[\s\S]*?;/g;
const originalRaise = "RAISE EXCEPTION 'Shared completion identity contract mismatch.';";
const withoutDiagnostics = (source: string) => source.replace(diagnosticRaises, originalRaise);
const withoutCaseParentheses = (source: string) => source
  .replace("IS DISTINCT FROM (CASE WHEN v_amended", "IS DISTINCT FROM CASE WHEN v_amended")
  .replace(
    "'7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' END)",
    "'7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' END",
  );

describe("shared completion identity migration (DC-SW8)", () => {
  it.each([
    ["up", up, "b5ab2cbd0c4b67ea7984a0bdcdd1ee5526bd068dc2f424dfb37f3e619c871fde"],
    ["down", down, "eb4a5a102b305bc3554387e3fe13d317c99a51c0e5cd0413438fa349b6685f38"],
  ])("%s preserves every byte outside the four RAISE expressions, CASE parentheses and exact anonymous ACL correction from 730ecff", (direction, source, expected) => {
    const aclCorrections = [
      ["ARRAY[0::oid, v_anon]::oid[]", "ARRAY[0]::oid[]"],
      direction === "up"
        ? [`REVOKE EXECUTE ON FUNCTION ${shared} FROM PUBLIC, anon;`, `REVOKE EXECUTE ON FUNCTION ${shared} FROM PUBLIC;`]
        : [`GRANT EXECUTE ON FUNCTION ${shared} TO PUBLIC, anon;`, `GRANT EXECUTE ON FUNCTION ${shared} TO PUBLIC;`],
    ] as const;
    for (const literal of [
      "IS DISTINCT FROM (CASE WHEN v_amended",
      "'7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' END)",
    ]) {
      expect(source.split(literal)).toHaveLength(2);
    }
    let historical = source;
    for (const [corrected, original] of aclCorrections) {
      expect(source.split(corrected)).toHaveLength(2);
      historical = historical.replace(corrected, original);
    }
    expect(hash(withoutCaseParentheses(withoutDiagnostics(historical)))).toBe(expected);
    const raises = [...guard(source).matchAll(diagnosticRaises)].map((match) => match[0]);
    expect(raises).toHaveLength(4);
    for (const [index, name] of ["roles", "attributes", "acl", "privileges"].entries()) {
      expect(raises[index]).toContain(`'SCID/' || '1/${name}/'`);
      expect(raises[index]).toContain("CASE WHEN v_phase = 1 THEN 'post' ELSE 'pre' END");
      expect(raises[index]).toContain("CASE WHEN bit THEN 't' WHEN NOT bit THEN 'f' ELSE 'u' END");
      expect(raises[index]).toContain("WITH ORDINALITY AS evidence(bit, position)");
      expect(raises[index]).not.toMatch(/ERRCODE|SQLSTATE|format\(|EXECUTE\s|v_\w+\.\w+::text/i);
    }
    expect(source).not.toMatch(/SCID\/1\/(?:roles|attributes|acl|privileges)\/(?:pre|post)\/\w+\/[tfu]+/);
  });

  it.each([["up", up], ["down", down]])("%s parenthesizes the shared-body IF CASE (DC-SW8)", (_, source) => {
    expect(guard(source)).toContain(
      "IF v_shared.oid IS NULL OR v_helper.oid IS NULL\n"
      + "       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_shared.prosrc, 'UTF8')), 'hex')\n"
      + "          IS DISTINCT FROM (CASE WHEN v_amended\n"
      + "            THEN 'cca40717ed9133607ea0706838ed999beea84af6a90336c66f61abe8b1690b3d'\n"
      + "            ELSE '7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' END)\n"
      + "       OR v_shared.proowner IS DISTINCT FROM v_postgres",
    );
  });

  it.each([["up", up], ["down", down]])("%s diagnoses every original expected condition in its original order", (_, source) => {
    const predicates = [...guard(withoutDiagnostics(source)).matchAll(
      /IF ([\s\S]*?) THEN\s+RAISE EXCEPTION 'Shared completion identity contract mismatch\.';/g,
    )].map((match) => match[1]!.split(/\s+OR\s+/));
    expect(predicates.map((clauses) => clauses.length)).toEqual([6, 48, 2, 10]);
    const raises = [...guard(source).matchAll(diagnosticRaises)].map((match) => match[0]);
    for (const [index, clauses] of predicates.entries()) {
      const diagnostic = raises[index]!.replace(/\s+/g, " ");
      let offset = 0;
      for (const clause of clauses) {
        const expected = withoutCaseParentheses(clause).replace(/IS DISTINCT FROM|IS NOT NULL|IS NULL/g, (operator) =>
          operator === "IS DISTINCT FROM" ? "IS NOT DISTINCT FROM" :
            operator === "IS NULL" ? "IS NOT NULL" : "IS NULL").replace(/\s+/g, " ");
        const position = diagnostic.indexOf(expected, offset);
        expect(position, expected).toBeGreaterThanOrEqual(offset);
        offset = position + expected.length;
      }
    }
    const acl = raises[2]!;
    expect(acl).toContain("v_proc.proacl IS NULL");
    expect(acl).toContain("pg_catalog.aclexplode(v_proc.proacl) acl WHERE acl.grantee = v_anon");
    expect(acl).toContain("pg_catalog.aclexplode(v_proc.proacl) acl WHERE acl.grantee = 0");
    for (const condition of ["acl.grantor = v_postgres", "acl.privilege_type = 'EXECUTE'", "NOT acl.is_grantable"]) {
      expect(acl).toContain(`bool_and(${condition})`);
    }
  });

  it("pins the full 0144 definition and changes exactly one identity expression", () => {
    const original = definition(baseline);
    expect(hash(original)).toBe("7a55fb642551dfa62237ab25c4def383c177094d0ccd7fbb02edd83d38a198b3");
    expect(original.match(/auth\.uid\(\)/g)).toHaveLength(1);
    expect(definition(up)).toBe(original.replace("auth.uid()", helper));
    expect(definition(down)).toBe(original);
    expect(definition(up)).not.toContain("SECURITY DEFINER");
  });

  it("pins the unchanged zero-argument identity-only helper and all three body hashes", () => {
    const original = identity.match(/CREATE FUNCTION public\.swim_request_user_id\(\)[\s\S]*?\$\$;/)?.[0];
    expect(original).toBe(
      "CREATE FUNCTION public.swim_request_user_id()\n"
      + "RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER\n"
      + "SET search_path = pg_catalog\nAS $$ SELECT auth.uid() $$;",
    );
    expect(hash(body(baseline))).toBe("7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d");
    expect(hash(body(up))).toBe("cca40717ed9133607ea0706838ed999beea84af6a90336c66f61abe8b1690b3d");
    expect(hash(" SELECT auth.uid() ")).toBe("c628b78ce1d2a3b15ddbaf7b0a5838fa26c925d332103e53f34ba73b9b227604");
    for (const source of [up, down]) {
      for (const value of [body(baseline), body(up), " SELECT auth.uid() "]) {
        expect(guard(source)).toContain(hash(value));
      }
      expect(source.match(/CREATE (?:OR REPLACE )?FUNCTION /g)).toHaveLength(1);
      expect(source).not.toMatch(/ALTER FUNCTION|DROP FUNCTION|pg_get_functiondef|EXECUTE\s+['"$]|replace\(/i);
    }
  });

  it.each([["up", up], ["down", down]])("%s pins catalog attributes and missing objects NULL-safely", (_, source) => {
    const checks = guard(source);
    expect(checks).toContain("v_shared.oid IS NULL OR v_helper.oid IS NULL");
    expect(checks).toContain("current_user IS DISTINCT FROM 'postgres'");
    for (const role of ["postgres", "authenticated", "service", "writer", "anon"]) {
      expect(checks).toContain(`v_${role} IS NULL`);
    }
    for (const name of ["shared", "helper"]) {
      for (const [attribute, value] of [
        ["proowner", "v_postgres"], ["prokind", "'f'"], ["proleakproof", "false"],
        ["proisstrict", "false"], ["proparallel", "'u'"], ["provariadic", "0::oid"],
        ["prosupport", "0::pg_catalog.regproc"],
      ]) {
        expect(checks).toContain(`v_${name}.${attribute} IS DISTINCT FROM ${value}`);
      }
      expect(checks).toContain(`v_${name}.probin IS NOT NULL OR v_${name}.prosqlbody IS NOT NULL`);
      expect(checks).toContain(`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_${name}.prosrc, 'UTF8')), 'hex')`);
    }
    const attributes = {
      shared: {
        prolang: "(SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')",
        provolatile: "'v'", prosecdef: "false",
        proconfig: "ARRAY['search_path=public']::text[]",
        pronargs: "3::smallint", pronargdefaults: "1::smallint",
        proargtypes: "'2950 25 2950'::pg_catalog.oidvector",
        proallargtypes: "ARRAY[2950,25,2950,2950,16]::oid[]",
        proargmodes: "ARRAY['i','i','i','t','t']::\"char\"[]",
        proargnames: "ARRAY['p_session_id','p_notes','p_completion_entry_id','user_id','transitioned']::text[]",
        prorettype: "'record'::pg_catalog.regtype", proretset: "true",
      },
      helper: {
        prolang: "(SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')",
        provolatile: "'s'", prosecdef: "true",
        proconfig: "ARRAY['search_path=pg_catalog']::text[]",
        pronargs: "0::smallint", pronargdefaults: "0::smallint",
        proargtypes: "''::pg_catalog.oidvector",
        prorettype: "'uuid'::pg_catalog.regtype", proretset: "false",
      },
    };
    for (const [name, fields] of Object.entries(attributes)) {
      for (const [field, expected] of Object.entries(fields)) {
        expect(checks).toContain(`v_${name}.${field} IS DISTINCT FROM ${expected}`);
      }
    }
    expect(checks).toContain("pg_catalog.pg_get_expr(v_shared.proargdefaults, 0) IS DISTINCT FROM 'NULL::uuid'");
    for (const field of ["proargdefaults", "proallargtypes", "proargmodes", "proargnames"]) {
      expect(checks).toContain(`v_helper.${field} IS NOT NULL`);
    }
    expect(withoutDiagnostics(checks).match(/RAISE EXCEPTION '[^']+';/g)).toEqual(
      Array(4).fill("RAISE EXCEPTION 'Shared completion identity contract mismatch.';"),
    );
  });

  it.each([["up", up], ["down", down]])("%s checks exact normalized ACLs and positive effective access", (_, source) => {
    const checks = guard(source);
    expect(checks).toContain("FOR v_proc IN SELECT * FROM pg_catalog.pg_proc WHERE oid IN (v_shared.oid, v_helper.oid) LOOP");
    expect(checks).toContain(
      "v_expected := CASE WHEN v_proc.oid = v_shared.oid\n"
      + "        THEN ARRAY[v_postgres, v_authenticated, v_service, v_writer]\n"
      + "          || CASE WHEN v_amended THEN ARRAY[]::oid[] ELSE ARRAY[0::oid, v_anon]::oid[] END\n"
      + "        ELSE ARRAY[v_postgres, v_service, v_writer]\n"
      + "          || CASE WHEN v_amended THEN ARRAY[v_authenticated] ELSE ARRAY[]::oid[] END END;",
    );
    expect(withoutDiagnostics(checks).match(/COALESCE\(v_proc\.proacl, pg_catalog\.acldefault\('f', v_proc\.proowner\)\)/g)).toHaveLength(2);
    expect(checks).toContain("array_agg(acl.grantee ORDER BY acl.grantee)");
    expect(checks).toContain("IS DISTINCT FROM (SELECT array_agg(grantee ORDER BY grantee) FROM unnest(v_expected) grantee)");
    expect(checks).toContain("bool_and(acl.grantor = v_postgres AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable)");
    for (const role of ["authenticated", "service", "writer", "postgres"]) {
      expect(checks).toContain(`has_function_privilege(v_${role}, v_shared.oid, 'EXECUTE') IS DISTINCT FROM true`);
    }
    for (const role of ["service", "writer", "postgres"]) {
      expect(checks).toContain(`has_function_privilege(v_${role}, v_helper.oid, 'EXECUTE') IS DISTINCT FROM true`);
    }
    expect(checks).toContain("has_function_privilege(v_anon, v_shared.oid, 'EXECUTE') IS DISTINCT FROM (NOT v_amended)");
    expect(checks).toContain("has_function_privilege(v_authenticated, v_helper.oid, 'EXECUTE') IS DISTINCT FROM v_amended");
    expect(checks).toContain("has_function_privilege(v_anon, v_helper.oid, 'EXECUTE') IS DISTINCT FROM false");
  });

  it("checks both states in one atomic block and limits mutation to the exact approved DDL", () => {
    expect(guard(down).replace("v_phase = 0", "v_phase = 1")
      .replace("amended state before mutation and the exact prior", "prior state before mutation and the exact amended"))
      .toBe(guard(up));
    for (const [source, amendedPhase, changes] of [
      [up, 1, `GRANT EXECUTE ON FUNCTION ${helper} TO authenticated;\n`
        + `      REVOKE EXECUTE ON FUNCTION ${shared} FROM PUBLIC, anon;`],
      [down, 0, `GRANT EXECUTE ON FUNCTION ${shared} TO PUBLIC, anon;\n`
        + `      REVOKE EXECUTE ON FUNCTION ${helper} FROM authenticated;`],
    ] as const) {
      expect(source).not.toContain("--> statement-breakpoint");
      expect(guard(source)).toContain(`FOR v_phase IN 0..1 LOOP\n    v_amended := v_phase = ${amendedPhase};`);
      const executable = source.replace(/^--.*$/gm, "").trim();
      expect(executable.startsWith(source === up ? "DO $migration$" : "BEGIN;\n\nDO $migration$")).toBe(true);
      const tail = source.slice(source.indexOf("    IF v_phase = 0 THEN"));
      expect(tail).toBe(
        `    IF v_phase = 0 THEN\n${definition(source)}\n\n      ${changes}\n`
        + "    END IF;\n  END LOOP;\nEND $migration$;\n"
        + (source === down ? "\nCOMMIT;\n" : ""),
      );
      expect(source.match(/(?:GRANT|REVOKE) EXECUTE ON FUNCTION [^;]+;/g)).toEqual(changes.split("\n      "));
      expect(source).not.toMatch(/CASCADE|ALTER (?:ROLE|TABLE|DEFAULT PRIVILEGES)|CREATE (?:ROLE|TABLE|POLICY)|SET ROLE|GRANT .*ON SCHEMA/);
    }
  });

  it("appends only the normal 0147 journal entry after the future-dated baseline", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json"));
    expect(hash(JSON.stringify(journal.entries.slice(0, 147))))
      .toBe("a1b64f3f3e615c153f38aaf4229062bd246a894c2542ce5e50ec7dc7e10bb172");
    expect(journal.entries[147]).toEqual({
      idx: 147, version: "7", when: 1788912000000,
      tag: "0147_shared_completion_identity", breakpoints: false,
    });
    expect(journal.entries[147].when).toBeGreaterThan(journal.entries[146].when);
  });
});
