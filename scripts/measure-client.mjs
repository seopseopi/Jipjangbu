// Run after a build: node scripts/measure-client.mjs
// Measure each entry's static import closure; lazy imports are not initial bytes.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const root = new URL("../dist/client/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(".vite/manifest.json", root), "utf8"));

function measure(entries) {
  const seen = new Set();
  const files = new Set();
  const lazy = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    const item = manifest[key];
    if (!item) throw new Error(`Missing build entry: ${key}`);
    files.add(item.file);
    for (const file of item.css ?? []) files.add(file);
    for (const dependency of item.imports ?? []) visit(dependency);
    for (const dependency of item.dynamicImports ?? []) lazy.add(dependency);
  }
  entries.forEach(visit);
  const assets = [...files].sort().map((file) => {
    const bytes = readFileSync(new URL(file, root));
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  });
  return {
    bytes: assets.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: assets.reduce((sum, file) => sum + file.gzipBytes, 0),
    assets,
    lazyEntries: [...lazy].filter((key) => !seen.has(key)).sort(),
  };
}

console.log(JSON.stringify({
  workspace: measure(["app/work-manager.tsx"]),
  withFrameworkEntry: measure(["virtual:vinext-app-browser-entry", "app/work-manager.tsx"]),
}, null, 2));
