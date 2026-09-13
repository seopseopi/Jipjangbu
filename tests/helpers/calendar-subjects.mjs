import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { calendarWorkPresentation } from "./calendar-presentation.mjs";
import { getPropertyDisplayGroups } from "../../app/property-display.ts";

const source = readFileSync(new URL("../../app/calendar-subjects.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("calendar-subjects.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CalendarSubjects");
if (!declaration) throw new Error("CalendarSubjects declaration is missing");
const compiled = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText.replace(/^export /gm, "");
export const CalendarSubjects = new Function("React", "calendarWorkPresentation", "getPropertyDisplayGroups", `${compiled}; return CalendarSubjects;`)(React, calendarWorkPresentation, getPropertyDisplayGroups);
