import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { getWorkProperties, workPropertyLabel } from "../../app/work-property-summary.ts";
import { getPropertyDisplayGroups } from "../../app/property-display.ts";

const source = readFileSync(new URL("../../app/work-summary-properties.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-summary-properties.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "WorkSummaryProperties");
if (!declaration) throw new Error("WorkSummaryProperties declaration is missing");
const compiled = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText.replace(/^export /gm, "");
export const WorkSummaryProperties = new Function("React", "getWorkProperties", "workPropertyLabel", "getPropertyDisplayGroups", `${compiled}; return WorkSummaryProperties;`)(React, getWorkProperties, workPropertyLabel, getPropertyDisplayGroups);
