// Inject each page's server-rendered markup into the HTML Vite built, so the
// site is readable before (or without) its JavaScript.
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const { renderPages } = await import(pathToFileURL(resolve(root, "dist-ssr/prerender.js")).href);
const MARKER = "<!--app-->";

for (const [path, markup] of Object.entries(renderPages())) {
  const file = resolve(root, "dist", path);
  const html = await readFile(file, "utf8");
  if (!html.includes(MARKER)) throw new Error(`${path} has no ${MARKER} marker to render into`);
  await writeFile(file, html.replace(MARKER, markup));
  console.log(`prerendered ${path} (${markup.length} bytes)`);
}

await rm(resolve(root, "dist-ssr"), { recursive: true, force: true });
