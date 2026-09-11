import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function luminance(hex) {
  const value = hex.slice(1);
  const normalized = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;
  const channels = [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a, b) {
  const lightness = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (lightness[0] + 0.05) / (lightness[1] + 0.05);
}

test("기본 본문·보조 설명·초록색 버튼의 대비를 유지한다", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const color = (name) => {
    const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`));
    assert.ok(match, `${name} color token is missing`);
    return match[1];
  };
  for (const foreground of ["ink", "muted"]) {
    for (const background of ["paper", "canvas"]) {
      assert.ok(contrast(color(foreground), color(background)) >= 4.5, `${foreground} on ${background} contrast is too low`);
    }
  }
  assert.ok(contrast("#fff", color("green")) >= 4.5, "primary button text contrast is too low");
  assert.ok(contrast(color("green"), color("paper")) >= 4.5, "green link text contrast is too low");
});
