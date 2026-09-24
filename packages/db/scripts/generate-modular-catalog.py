"""Derive the release manifest without a database. Requires pglast==8.4.

Run with --write to regenerate, or without arguments to check the committed output.
This handles only the hash-pinned 0156-0158 syntax, not arbitrary future migrations.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

import pglast
from pglast import ast, parse_sql

assert pglast.__version__ == "v8.4"
root = Path(__file__).resolve().parent
pins = [
    {"tag": tag, "hash": digest, "folderMillis": int(timestamp)}
    for tag, digest, timestamp in re.findall(
        r'\{ tag: "(015[678]_[a-z_]+)", hash: "([a-f0-9]{64})", folderMillis: (\d+) \}',
        (root / "modular-production-preflight-guards.ts").read_text(encoding="utf-8"),
    )
]
assert len(pins) == 3
keys, replaced, columns, functions = set(), set(), {}, {}


def relation(node):
    assert node.schemaname == "public"
    return node.relname


def add(kind, name):
    key = f"{kind}:public.{name}"
    assert key not in keys
    keys.add(key)


def column_refs(node):
    if isinstance(node, dict):
        if node.get("@") == "ColumnRef":
            yield node["fields"][-1].get("sval")
        for value in node.values():
            yield from column_refs(value)
    elif isinstance(node, (tuple, list)):
        for value in node:
            yield from column_refs(value)


def constraint(table, node, column=None):
    kind = node.contype.name
    if kind in ("CONSTR_NOTNULL", "CONSTR_DEFAULT"):
        return
    name = node.conname
    if not name:
        if kind == "CONSTR_PRIMARY":
            name = f"{table}_pkey"
        elif kind in ("CONSTR_FOREIGN", "CONSTR_UNIQUE"):
            fields = [column] if column else [value.sval for value in node.keys]
            assert all(fields)
            name = f"{table}_{'_'.join(fields)}_{'fkey' if kind == 'CONSTR_FOREIGN' else 'key'}"
        elif kind == "CONSTR_CHECK":
            refs = set(column_refs(node.raw_expr())) & set(columns[table])
            # PostgreSQL uses a column label only for single-column CHECKs.
            name = f"{table}_{next(iter(refs)) + '_' if len(refs) == 1 else ''}check"
        else:
            raise AssertionError(f"Unsupported implicit constraint: {kind}")
    assert len(name.encode("utf-8")) <= 63
    if f"{table}.{name}" not in replaced:
        add("constraint", f"{table}.{name}")
        if kind in ("CONSTR_PRIMARY", "CONSTR_UNIQUE"):
            add("index", name)


for pin in pins:
    source = (root.parent / "drizzle" / (pin["tag"] + ".sql")).read_bytes()
    assert hashlib.sha256(source).hexdigest() == pin["hash"]
    for raw in parse_sql(source.decode("utf-8")):
        node = raw.stmt
        if isinstance(node, ast.CreateStmt):
            table = relation(node.relation)
            add("relation", table)
            columns[table] = [item.colname for item in node.tableElts if isinstance(item, ast.ColumnDef)]
            for item in node.tableElts:
                if isinstance(item, ast.ColumnDef):
                    add("column", f"{table}.{item.colname}")
                    for check in item.constraints or ():
                        constraint(table, check, item.colname)
                else:
                    assert isinstance(item, ast.Constraint)
                    constraint(table, item)
        elif isinstance(node, ast.AlterTableStmt):
            table = relation(node.relation)
            for command in node.cmds:
                kind = command.subtype.name
                if kind == "AT_DropConstraint":
                    replaced.add(f"{table}.{command.name}")
                elif kind == "AT_AddConstraint":
                    constraint(table, command.def_)
                elif kind == "AT_AddColumn":
                    add("column", f"{table}.{command.def_.colname}")
                else:
                    assert kind == "AT_EnableRowSecurity"
        elif isinstance(node, ast.CreateFunctionStmt):
            assert not node.replace and node.funcname[0].sval == "public"
            name = node.funcname[1].sval
            add("function", name)
            functions[name] = {"name": name, "owner": "current_user", "definer": False, "config": []}
            for option in node.options:
                if option.defname == "security":
                    functions[name]["definer"] = option.arg.boolval
                elif option.defname == "set":
                    functions[name]["config"].append(
                        option.arg.name + "=" + ", ".join(value.val.sval for value in option.arg.args)
                    )
        elif isinstance(node, ast.AlterOwnerStmt):
            assert node.objectType.name == "OBJECT_FUNCTION" and node.object.objname[0].sval == "public"
            functions[node.object.objname[1].sval]["owner"] = node.newowner.rolename
        elif isinstance(node, ast.ViewStmt):
            view = relation(node.view)
            add("relation", view)
            selected = []
            for target in node.query.targetList:
                if target.name:
                    selected.append(target.name)
                elif isinstance(target.val, ast.ColumnRef):
                    field = target.val.fields[-1]
                    if isinstance(field, ast.A_Star):
                        assert len(node.query.fromClause) == 1
                        selected.extend(columns[relation(node.query.fromClause[0])])
                    else:
                        selected.append(field.sval)
                else:
                    raise AssertionError("Unnamed view expression")
            columns[view] = selected
            for column in selected:
                add("column", f"{view}.{column}")
        elif isinstance(node, ast.IndexStmt):
            relation(node.relation)
            add("index", node.idxname)
        elif isinstance(node, ast.CreateTrigStmt):
            name = f"{relation(node.relation)}.{node.trigname}"
            add("trigger", name)
            if node.isconstraint:
                add("constraint", name)
        elif isinstance(node, ast.CreatePolicyStmt):
            add("policy", f"{relation(node.table)}.{node.policy_name}")
        else:
            # These pinned DO blocks only validate or replace existing function bodies.
            assert isinstance(node, (ast.DoStmt, ast.GrantStmt, ast.DropStmt))
            if isinstance(node, ast.DropStmt):
                assert node.removeType.name == "OBJECT_INDEX"

manifest = {"migrations": pins, "keys": sorted(keys), "functions": [functions[name] for name in sorted(functions)]}
output = "// Generated from pinned DDL by generate-modular-catalog.py; do not edit.\n"
output += "export const MODULAR_CATALOG_MANIFEST = " + json.dumps(manifest, indent=2) + " as const;\n"
target = root / "modular-production-catalog-manifest.ts"
if sys.argv[1:] == ["--write"]:
    target.write_text(output, encoding="utf-8", newline="\n")
else:
    assert not sys.argv[1:]
    assert target.read_text(encoding="utf-8") == output, "Regenerate the catalog manifest"
print(f"Pinned-DDL catalog manifest: {len(keys)} exact keys, {len(functions)} functions")
