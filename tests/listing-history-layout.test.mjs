import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the actual modal markup without a browser or real customer records.
const source = readFileSync(new URL("../app/work-manager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "HistoryModal");
assert.ok(declaration, "HistoryModal exists");
const compiled = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText;
const HistoryModal = new Function("React", "Modal", "Icon", "EmptyState", "targetText", "displayDate", "statusTone", `${compiled}; return HistoryModal;`)(
  React, ({ children }) => children, "span", "aside", () => "예시 매물",
  (date) => `표시 날짜 ${date}`, (status) => `tone-${status}`,
);

function elements(children) {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    return child.type === React.Fragment ? elements(child.props.children) : [child];
  });
}

function descendants(element) {
  return [element, ...elements(element.props.children).flatMap(descendants)];
}

function hasClass(element, name) {
  return element.props.className?.split(/\s+/).includes(name);
}

function renderHistory(listing, onFollowUp, { items = [], customer, onOpenWork = () => {} } = {}) {
  return HistoryModal({
    data: { title: "예시 매물 이력", subtitle: "테스트", items, listing, customer },
    onClose: () => {}, onRefresh: () => {}, onOpenWork,
    onNewWork: () => {}, onCopy: () => {}, onFollowUp,
  });
}

test("매물 이력 메모는 가격 아래 독립 행에 원문을 보존하고 할 일 버튼은 카드 밖에서 같은 매물에 연결된다", () => {
  const notes = `  첫 상담 메모\n\n<확인> & 추가 내용\n${"긴메모".repeat(120)}\n마지막 줄  `;
  for (const sourceNotes of [notes, ""]) {
    const listing = {
      identity_key: "아파트|예시||101", status: "상담", sale_price: "확인 필요",
      jeonse_price: "", monthly_rent: "", source_notes: sourceNotes,
    };
    const calls = [];
    const tree = renderHistory(listing, (draft) => calls.push(draft));
    const siblings = elements(tree.props.children);
    const contextIndex = siblings.findIndex((element) => hasClass(element, "listing-history-context"));
    assert.ok(contextIndex >= 0, "listing summary card exists");
    const context = siblings[contextIndex];
    assert.equal(hasClass(context, "editor-context"), false, "listing history must not inherit the editor's horizontal flex layout");
    const rows = elements(context.props.children);
    assert.equal(hasClass(rows[0], "listing-history-summary"), true);
    assert.match(renderToStaticMarkup(rows[0]), /상담/);
    assert.match(renderToStaticMarkup(rows[0]), /매매 확인 필요/);
    assert.equal(descendants(context).some((element) => element.type === "button"), false);
    if (sourceNotes) {
      assert.equal(rows.length, 2);
      assert.equal(hasClass(rows[1], "listing-history-notes"), true);
      assert.equal(rows[1].props.children, notes, "notes are not trimmed, shortened or split into narrow columns");
      const rendered = renderToStaticMarkup(rows[1]);
      assert.ok(rendered.includes(notes.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")), "line breaks and long text survive rendering as escaped text");
    } else {
      assert.equal(rows.length, 1, "empty notes do not leave an empty row");
    }
    const actions = siblings[contextIndex + 1];
    assert.ok(actions && hasClass(actions, "listing-history-actions"), "actions occupy a separate row after the summary card");
    const buttons = descendants(actions).filter((element) => element.type === "button");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].props.type, "button");
    assert.ok(React.Children.toArray(buttons[0].props.children).some((child) => typeof child === "string" && child.includes("이 매물 확인할 일 추가")));
    assert.deepEqual(calls, [], "rendering history does not create a follow-up");
    buttons[0].props.onClick();
    assert.deepEqual(calls, [{ title: "예시 매물 매물 확인", listingKey: listing.identity_key, listingLabel: "예시 매물" }]);
    assert.ok(siblings.findIndex((element) => hasClass(element, "history-list")) > contextIndex + 1);
  }
  assert.equal(descendants(renderHistory(undefined, assert.fail)).some((element) => hasClass(element, "listing-history-actions")), false);
});

test("고객·매물의 각 이력은 날짜·상태 아래 전체 폭 본문을 보존하고 연결된 업무만 열 수 있다", () => {
  const content = `  첫 확인 내용\n\n<입력 원문> & 추가 메모\n${"상세기록".repeat(120)}\n마지막 줄  `;
  const examples = [
    {
      customer: { id: "customer-synthetic", name: "예시 고객" },
      items: [
        { id: "work-synthetic", work_date: "2026-09-12", work_type: "전화상담", content },
        { id: "work-empty", work_date: "2026-09-11", work_type: "방문", content: "" },
      ],
    },
    {
      listing: { identity_key: "아파트|예시||101", status: "상담", source_notes: "" },
      items: [
        { id: "event-synthetic", event_date: "2026-09-12", status: "매물확인", notes: content, work_log_id: "linked-work", customer_name: "연결 고객" },
        { id: "event-without-work", event_date: "2026-09-11", status: "이전기록", notes: "", work_log_id: null, customer_name: "예시 이름" },
      ],
    },
  ];
  for (const example of examples) {
    const opened = [];
    const tree = renderHistory(example.listing, assert.fail, { ...example, onOpenWork: (id) => opened.push(id) });
    assert.equal(tree.props.reading, true, "both history types use the reading-width modal");
    const list = elements(tree.props.children).find((element) => hasClass(element, "history-list"));
    const rows = elements(list.props.children);
    assert.equal(rows.length, example.items.length);
    for (const [index, row] of rows.entries()) {
      const raw = example.items[index];
      const isEvent = "event_date" in raw;
      const date = isEvent ? raw.event_date : raw.work_date;
      const status = isEvent ? raw.status : raw.work_type;
      const id = isEvent ? raw.work_log_id : raw.id;
      const expectedContent = (isEvent ? raw.notes : raw.content) || "기록된 내용 없음";
      assert.equal(row.type, "button");
      const [meta, body, unexpected] = elements(row.props.children);
      assert.equal(unexpected, undefined);
      assert.equal(hasClass(meta, "history-entry-meta"), true);
      assert.equal(hasClass(body, "history-entry-content"), true);
      assert.equal(body.type, "p");
      assert.equal(body.props.children, expectedContent, "the complete body is a sibling below metadata, not a narrow metadata column");
      const metadata = elements(meta.props.children);
      const time = metadata.find((element) => element.type === "time");
      assert.equal(time.props.dateTime, date);
      assert.equal(time.props.children, `표시 날짜 ${date}`);
      assert.equal(metadata.find((element) => element.type === "strong").props.children, status);
      const customerName = metadata.find((element) => element.type === "small");
      assert.equal(customerName?.props.children, isEvent ? raw.customer_name : undefined);
      assert.equal(row.props.disabled, !id);
      row.props.onClick();
    }
    assert.deepEqual(opened, example.items.map((raw) => "event_date" in raw ? raw.work_log_id : raw.id).filter(Boolean));
    assert.ok(renderToStaticMarkup(tree).includes(content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")), "rendered customer and listing histories retain escaped text, spaces and line breaks");
  }
});

test("매물 이력은 한 열 전체 폭을 쓰고 긴 메모와 버튼은 좁은 화면에서도 줄바꿈할 수 있다", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  function declarations(selector) {
    const rules = {};
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!match[1].split(",").some((value) => value.trim() === selector)) continue;
      for (const declaration of match[2].split(";")) {
        const colon = declaration.indexOf(":");
        if (colon >= 0) rules[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
    }
    return rules;
  }
  const context = declarations(".listing-history-context");
  const notes = declarations(".listing-history-notes");
  const actions = declarations(".listing-history-actions");
  const button = declarations(".listing-history-actions > button");
  assert.equal(context.display, "grid");
  assert.match(context["grid-template-columns"], /^minmax\(0,\s*1fr\)$/);
  assert.equal(notes["white-space"], "pre-wrap");
  assert.equal(notes["overflow-wrap"], "anywhere");
  assert.ok(context["min-width"] === "0" || notes["min-width"] === "0");
  assert.equal(actions.display, "flex");
  assert.equal(actions["justify-content"], "flex-end");
  assert.equal(actions["flex-wrap"], "wrap");
  assert.equal(button["max-width"], "100%");
  assert.equal(button["white-space"], "normal");
  const entry = declarations(".history-list > button");
  const metadata = declarations(".history-entry-meta");
  const content = declarations(".history-list p");
  assert.equal(entry.display, "grid");
  assert.match(entry["grid-template-columns"], /^minmax\(0,\s*1fr\)$/);
  assert.equal(metadata["flex-wrap"], "wrap");
  assert.equal(content["white-space"], "pre-wrap");
  assert.equal(content["overflow-wrap"], "anywhere");
});
