import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";

const source = readFileSync(new URL("../../app/listing-history-summary.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("listing-history-summary.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(ast)).join("\n");
const compiled = ts.transpileModule(declarations, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText.replace(/^export /gm, "");
export const ListingHistorySummary = new Function("React", "Icon", `${compiled}; return ListingHistorySummary;`)(React, () => null);
