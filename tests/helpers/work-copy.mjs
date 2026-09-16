import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { propertyFromListing } from "../../app/listing-draft.ts";

const source = readFileSync(new URL("../../app/work-manager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modal = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "WorkModal");
assert.ok(modal);
export const workModalSource = modal.getText(ast);

function run(code, environment, result) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(...Object.keys(environment), `${compiled}; return ${result};`)(...Object.values(environment));
}

/** Execute the production form initializers without mounting an app or using private data. */
export function initialWorkDraft(state, today = "2026-09-16") {
  const statements = [];
  for (const statement of modal.body.statements) {
    if (statement.getText(ast).startsWith("const [saving,")) break;
    statements.push(statement.getText(ast));
  }
  return run(statements.join("\n"), {
    modal: state,
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    seoulDate: () => today,
    propertyFromListing,
    blankProperty: () => propertyFromListing({ identity_key: "synthetic-empty" }),
  }, "({ item, workDate, customerId, workType, content, details })");
}

export function workModalHandler(name, environment) {
  const declaration = modal.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return run(declaration.getText(ast), environment, name);
}
