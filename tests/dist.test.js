// Invariants of the built site. Run after `npm run build`.
//
// These are the properties a dependency bump or a bundler change could break
// without any source file here changing.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const dist = resolve(import.meta.dirname, "../dist");
const PAGES = ["index.html"];
// connect-src is the one widening over the sign-in relay's policy: the page
// exists to make requests to boards on the visitor's network, over plain
// HTTP. CSP cannot express "private addresses only"; discovery.js enforces
// that (mayProbe) and its tests cover it.
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src http: https:; base-uri 'none'; form-action 'none'";

const read = (path) => readFileSync(resolve(dist, path), "utf8");
const attributes = (html, tag, name) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`, "g"))].map((match) => match[1]);

test("GitHub Pages is told not to run Jekyll", () => {
  assert.ok(existsSync(resolve(dist, ".nojekyll")));
});

for (const page of PAGES) {
  const html = read(page);

  test(`${page} sets the Content-Security-Policy`, () => {
    assert.deepEqual(attributes(html, "meta", "content").filter((value) => value.startsWith("default-src")), [CSP]);
  });

  test(`${page} sends no referrer`, () => {
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
  });

  test(`${page} has no inline script, which the CSP would block`, () => {
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(attrs, /\ssrc="/, `inline <script> found: ${body.slice(0, 80)}`);
      assert.equal(body.trim(), "");
    }
    assert.doesNotMatch(html, /\son[a-z]+="/, "inline event handler found");
  });

  test(`${page} has no inline style, which the CSP would block`, () => {
    assert.doesNotMatch(html, /<style\b/);
    assert.doesNotMatch(html, /\sstyle="/);
  });

  test(`${page} loads scripts, styles and icons only from this site, by relative path`, () => {
    const urls = [
      ...attributes(html, "script", "src"),
      ...attributes(html, "link", "href"),
      ...attributes(html, "img", "src"),
    ];
    assert.ok(urls.length > 0);
    for (const url of urls) {
      assert.doesNotMatch(url, /^([a-z][a-z0-9+.-]*:|\/)/i, `${url} is not relative`);
      assert.ok(existsSync(resolve(dist, dirname(page), url)), `${url} does not exist in dist`);
    }
  });

  test(`${page} is prerendered with its search button`, () => {
    assert.doesNotMatch(html, /<!--app-->/);
    assert.match(html, /<div id="root"><main\b/);
    assert.match(html, /<h1\b[^>]*>[^<]*Find your FiestaBoard/);
    assert.match(html, /Search my network/);
  });
}

test("no script or stylesheet references another host", () => {
  for (const file of readdirSync(resolve(dist, "assets")).filter((name) => /\.(css)$/.test(name))) {
    const css = readFileSync(resolve(dist, "assets", file), "utf8");
    for (const [, url] of css.matchAll(/url\(([^)]+)\)/g)) {
      assert.doesNotMatch(url.replace(/^["']/, ""), /^(https?:)?\/\//, `${file} loads ${url}`);
    }
    assert.doesNotMatch(css, /@import\s+(url\()?["']?https?:/);
  }
});

test("the bundle asks boards only through the paths every release serves", () => {
  const js = readdirSync(resolve(dist, "assets"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(resolve(dist, "assets", name), "utf8"))
    .join("\n");
  assert.match(js, /["'`]\/api\/["'`]/);
  assert.match(js, /["'`]\/api\/discover["'`]/);
});
