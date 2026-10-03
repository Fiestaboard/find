import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_NAME,
  BLOCKED_MS,
  COMMON_SUBNETS,
  MAX_SUBNETS,
  NAMED_CANDIDATES,
  addBoard,
  boardUrl,
  destinationPath,
  firstPassCandidates,
  isLoopback,
  gatewayPresent,
  gatewayUrl,
  isBoardIdentity,
  knownAddresses,
  looksBlocked,
  mayProbe,
  parseDiscover,
  parseSubnet,
  parseTypedAddress,
  limiter,
  SCAN_CONCURRENCY,
  rememberAddress,
  scanSubnet,
  searchNetwork,
  subnetCandidates,
  subnetsToScan,
} from "../src/lib/discovery.js";

// --- What is asked -------------------------------------------------------

test("a subnet is scanned host by host on the board's port, skipping .0 and .255", () => {
  const hosts = subnetCandidates("192.168.1");
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "http://192.168.1.1:4420");
  assert.equal(hosts.at(-1), "http://192.168.1.254:4420");
});

test("the router is asked on port 80 at .1", () => {
  assert.equal(gatewayUrl("10.0.0"), "http://10.0.0.1/");
});

test("every common subnet is a private range", () => {
  for (const prefix of COMMON_SUBNETS) assert.equal(mayProbe(`http://${prefix}.20:4420`), true, prefix);
});

test("the first pass asks known boards before the well-known names, once each", () => {
  const known = ["http://192.168.1.80:4420", "http://fiestapi.local:4420"];
  const first = firstPassCandidates(known);
  assert.deepEqual(first.slice(0, 2), known);
  assert.equal(first.filter((a) => a === "http://fiestapi.local:4420").length, 1);
  for (const name of NAMED_CANDIDATES) assert.ok(first.includes(name));
});

test("this computer's own addresses are never asked, known or not", () => {
  // Chrome asks a second, separate question before a page may reach them.
  const first = firstPassCandidates(["http://localhost:4420", "http://127.0.0.1:4420", "http://[::1]:4420", "http://10.0.0.9:4420"]);
  assert.deepEqual(first.filter(isLoopback), []);
  assert.ok(first.includes("http://10.0.0.9:4420"));
  assert.ok(!NAMED_CANDIDATES.some(isLoopback));
});

test("the Raspberry Pi image's name is among the well-known names", () => {
  assert.ok(NAMED_CANDIDATES.includes("http://fiestapi.local:4420"));
});

test("only local addresses may be probed", () => {
  assert.equal(mayProbe("http://192.168.0.155:4420"), true);
  assert.equal(mayProbe("http://fiestaboard.local:4420"), true);
  assert.equal(mayProbe("http://example.com:4420"), false);
  assert.equal(mayProbe("http://8.8.8.8:4420"), false);
  assert.equal(mayProbe("not a url"), false);
});

// --- Which subnets are scanned -------------------------------------------

test("a router that answers marks its subnet present", () => {
  assert.equal(gatewayPresent({ ok: true, ms: 900 }), true);
});

test("a router that refuses quickly still marks its subnet present", () => {
  assert.equal(gatewayPresent({ ok: false, ms: 3 }), true);
  assert.equal(gatewayPresent({ ok: false, ms: 400 }), true);
});

test("an address that times out marks its subnet absent", () => {
  assert.equal(gatewayPresent({ ok: false, ms: 2000 }), false);
});

test("only subnets whose router is present are scanned, in the usual order", () => {
  const results = Object.fromEntries(COMMON_SUBNETS.map((p) => [p, { ok: false, ms: 2000 }]));
  results["192.168.0"] = { ok: true, ms: 12 };
  results["10.0.0"] = { ok: false, ms: 5 };
  assert.deepEqual(subnetsToScan(results), ["192.168.0", "10.0.0"]);
});

test("when no router answers, the most common subnets are scanned anyway", () => {
  const results = Object.fromEntries(COMMON_SUBNETS.map((p) => [p, { ok: false, ms: 2000 }]));
  assert.deepEqual(subnetsToScan(results), ["192.168.1", "192.168.0"]);
});

test("no more than a few subnets are scanned however many routers answer", () => {
  const results = Object.fromEntries(COMMON_SUBNETS.map((p) => [p, { ok: true, ms: 1 }]));
  assert.equal(subnetsToScan(results).length, MAX_SUBNETS);
});

test("every request failing instantly means the browser is blocking them", () => {
  assert.equal(looksBlocked(COMMON_SUBNETS.map(() => ({ ok: false, ms: 1 }))), true);
});

test("one slow failure means requests are leaving the browser", () => {
  const results = COMMON_SUBNETS.map(() => ({ ok: false, ms: 1 }));
  results[3] = { ok: false, ms: 2000 };
  assert.equal(looksBlocked(results), false);
});

test("one answer means requests are leaving the browser", () => {
  const results = COMMON_SUBNETS.map(() => ({ ok: false, ms: 1 }));
  results[0] = { ok: true, ms: 1 };
  assert.equal(looksBlocked(results), false);
});

test("a failure at the threshold is not counted as blocked", () => {
  assert.equal(looksBlocked([{ ok: false, ms: BLOCKED_MS }]), false);
  assert.equal(looksBlocked([]), false);
});

// --- Reading answers -----------------------------------------------------

test("a board is recognised by the name every release answers /api/ with", () => {
  assert.equal(isBoardIdentity({ name: API_NAME, version: "1.0.0", status: "running" }), true);
});

test("anything else at /api/ is not a board", () => {
  assert.equal(isBoardIdentity({ name: "Home Assistant" }), false);
  assert.equal(isBoardIdentity(null), false);
  assert.equal(isBoardIdentity("FiestaBoard Display API"), false);
});

test("the discover response gives the id, name and version", () => {
  assert.deepEqual(parseDiscover({ product: "FiestaBoard", version: "9.9.0", id: "C0_y0Ig3Vwlr5PksRbx2TA", name: "Kitchen" }), {
    id: "C0_y0Ig3Vwlr5PksRbx2TA",
    name: "Kitchen",
    version: "9.9.0",
  });
});

test("the discover response is ignored unless it says it is a FiestaBoard", () => {
  assert.deepEqual(parseDiscover({ product: "Other", id: "C0_y0Ig3Vwlr5PksRbx2TA" }), {});
  assert.deepEqual(parseDiscover(undefined), {});
});

test("a malformed id is dropped and long or odd text is trimmed", () => {
  const parsed = parseDiscover({ product: "FiestaBoard", id: "<x>", name: `  ${"n".repeat(100)}\u0007`, version: 9 });
  assert.equal(parsed.id, "");
  assert.equal(parsed.name.length, 60);
  assert.equal(parsed.version, "");
});

// --- Listing boards ------------------------------------------------------

test("one board seen at its IP and its name is listed once, by name", () => {
  let boards = addBoard([], { address: "http://192.168.0.155:4420", id: "abcdefgh12", version: "9.9.0", name: "" });
  boards = addBoard(boards, { address: "http://fiestapi.local:4420", id: "abcdefgh12", version: "9.9.0", name: "" });
  assert.equal(boards.length, 1);
  assert.equal(boards[0].address, "http://fiestapi.local:4420");
  assert.deepEqual(boards[0].aliases, ["http://192.168.0.155:4420"]);
});

test("localhost is the last choice of address for a board", () => {
  let boards = addBoard([], { address: "http://localhost:4420", id: "abcdefgh12" });
  boards = addBoard(boards, { address: "http://192.168.0.20:4420", id: "abcdefgh12" });
  assert.equal(boards[0].address, "http://192.168.0.20:4420");
});

test("two boards with different ids are two entries", () => {
  let boards = addBoard([], { address: "http://192.168.0.10:4420", id: "aaaaaaaa11" });
  boards = addBoard(boards, { address: "http://192.168.0.11:4420", id: "bbbbbbbb22" });
  assert.equal(boards.length, 2);
});

test("boards too old to report an id are listed per address", () => {
  let boards = addBoard([], { address: "http://192.168.0.10:4420", id: "" });
  boards = addBoard(boards, { address: "http://fiestapi.local:4420", id: "" });
  assert.equal(boards.length, 2);
});

test("the same address reported twice stays one entry", () => {
  let boards = addBoard([], { address: "http://192.168.0.10:4420", id: "" });
  boards = addBoard(boards, { address: "http://192.168.0.10:4420", id: "" });
  assert.equal(boards.length, 1);
  assert.deepEqual(boards[0].aliases, []);
});

// --- Remembering ---------------------------------------------------------

test("known addresses put this page's list first and add the relay's", () => {
  const own = JSON.stringify(["http://192.168.1.80:4420"]);
  const relay = JSON.stringify(["http://192.168.1.80:4420", "http://fiestaboard.local:4420"]);
  assert.deepEqual(knownAddresses(own, relay), ["http://192.168.1.80:4420", "http://fiestaboard.local:4420"]);
});

test("known addresses drop anything that is not local, however it got into storage", () => {
  const planted = JSON.stringify(["https://evil.example", "http://8.8.8.8", "javascript:alert(1)", "http://10.0.0.5:4420"]);
  assert.deepEqual(knownAddresses(planted, null), ["http://10.0.0.5:4420"]);
});

test("unreadable storage is treated as empty", () => {
  assert.deepEqual(knownAddresses("{not json", "42"), []);
  assert.deepEqual(knownAddresses(null, undefined), []);
});

test("remembering puts the address first, once, in a bounded list", () => {
  let raw = null;
  for (let i = 1; i <= 25; i += 1) raw = rememberAddress(raw, `http://10.0.0.${i}:4420`);
  raw = rememberAddress(raw, "http://10.0.0.24:4420");
  const list = JSON.parse(raw);
  assert.equal(list.length, 20);
  assert.equal(list[0], "http://10.0.0.24:4420");
  assert.equal(list.filter((a) => a === "http://10.0.0.24:4420").length, 1);
});

test("a public address is never remembered", () => {
  assert.deepEqual(JSON.parse(rememberAddress(null, "https://example.com")), []);
});

// --- Deep links ----------------------------------------------------------

test("?to= lands on a path on the board", () => {
  assert.equal(destinationPath("?to=/settings"), "/settings");
  assert.equal(destinationPath("?to=%2Fintegrations%2Fweather"), "/integrations/weather");
  assert.equal(destinationPath("?to=/pages?board=kitchen"), "/pages?board=kitchen");
});

test("?to= never leaves the board", () => {
  for (const to of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "settings", "/a b", "/<x>"]) {
    assert.equal(destinationPath(`?to=${encodeURIComponent(to)}`), "", to);
  }
});

test("?to= that is missing, the root, or very long is ignored", () => {
  assert.equal(destinationPath(""), "");
  assert.equal(destinationPath("?to=/"), "");
  assert.equal(destinationPath(`?to=/${"a".repeat(300)}`), "");
});

test("a board's link carries the destination path", () => {
  assert.equal(boardUrl("http://fiestapi.local:4420", "/settings"), "http://fiestapi.local:4420/settings");
  assert.equal(boardUrl("http://fiestapi.local:4420", ""), "http://fiestapi.local:4420/");
});

// --- Typed input ---------------------------------------------------------

test("a typed local address is normalised", () => {
  assert.deepEqual(parseTypedAddress("192.168.0.155:4420/"), { ok: true, address: "http://192.168.0.155:4420" });
});

test("a typed public address may be opened, for boards behind a proxy", () => {
  assert.deepEqual(parseTypedAddress("https://board.example.com/"), { ok: true, address: "https://board.example.com" });
});

test("a typed address with a password or a scheme other than http is refused", () => {
  assert.equal(parseTypedAddress("http://me:pw@10.0.0.2").ok, false);
  assert.equal(parseTypedAddress("javascript:alert(1)").ok, false);
  assert.equal(parseTypedAddress("").ok, false);
});

test("a typed subnet is read in the forms routers show it", () => {
  for (const input of ["192.168.7", "192.168.7.x", "192.168.7.*", "192.168.7.0/24", " 10.20.30.X "]) {
    assert.ok(parseSubnet(input), input);
  }
  assert.equal(parseSubnet("192.168.7.x"), "192.168.7");
});

test("a full address is not a subnet", () => {
  assert.equal(parseSubnet("192.168.7.20"), null);
});

test("public, loopback and malformed ranges are not scanned", () => {
  for (const input of ["8.8.8", "8.8.8.x", "127.0.0", "192.168.300", "fiestapi.local", ""]) {
    assert.equal(parseSubnet(input), null, input);
  }
});

// --- Running the search --------------------------------------------------

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("limiter never runs more than its limit at once, and runs everything", async () => {
  const run = limiter(7);
  let running = 0;
  let peak = 0;
  const results = await Promise.all(
    [...Array(50).keys()].map((n) =>
      run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick(1);
        running -= 1;
        return n * 2;
      }),
    ),
  );
  assert.equal(peak, 7);
  assert.deepEqual(results, [...Array(50).keys()].map((n) => n * 2));
});

test("limiter keeps going after a task fails", async () => {
  const run = limiter(1);
  await assert.rejects(run(async () => {
    throw new Error("boom");
  }));
  assert.equal(await run(async () => "next"), "next");
});

/**
 * A pretend network: *boards* maps addresses to what /api/discover says,
 * *routers* lists subnet prefixes whose .1 answers, *blocked* refuses every
 * request instantly the way Safari does. Absent routers take *silentMs* to
 * time out; every address takes *answerMs* to answer or give up.
 */
function network({ boards = {}, routers = [], blocked = false, silentMs = 0, answerMs = 0 } = {}) {
  const asked = [];
  let inFlight = 0;
  const net = {
    asked,
    peak: 0,
    identify: async (address) => {
      asked.push(address);
      inFlight += 1;
      net.peak = Math.max(net.peak, inFlight);
      if (answerMs) await tick(answerMs);
      inFlight -= 1;
      return boards[address] ? { address, ...boards[address] } : null;
    },
    reach: async (url) => {
      if (blocked) return { ok: false, ms: 1 };
      const prefix = new URL(url).hostname.split(".").slice(0, 3).join(".");
      if (routers.includes(prefix)) return { ok: true, ms: 8 };
      if (silentMs) await tick(silentMs);
      return { ok: false, ms: 2000 };
    },
  };
  return net;
}

test("the search finds a board on the subnet its router is on", async () => {
  const net = network({ routers: ["192.168.0"], boards: { "http://192.168.0.155:4420": { id: "abcdefgh12" } } });
  const found = [];
  const result = await searchNetwork({ known: [], ...net, onFound: (b) => found.push(b) });
  assert.deepEqual(result, { blocked: false });
  assert.deepEqual(found.map((b) => b.address), ["http://192.168.0.155:4420"]);
  assert.ok(!net.asked.some((a) => a.startsWith("http://192.168.1.")), "a subnet with no router was scanned");
});

test("a subnet is scanned as soon as its router answers, not after the silent ones time out", async () => {
  const net = network({
    routers: ["192.168.0"],
    silentMs: 300,
    boards: { "http://192.168.0.155:4420": { id: "abcdefgh12" } },
  });
  const started = Date.now();
  let foundAfter = null;
  await searchNetwork({ known: [], ...net, onFound: () => (foundAfter ??= Date.now() - started) });
  assert.ok(foundAfter < 150, `board reported after ${foundAfter}ms; the silent routers take 300ms`);
});

test("scanning several subnets shares one limit on requests in flight", async () => {
  const net = network({ routers: ["192.168.1", "192.168.0", "10.0.0"], answerMs: 2 });
  await searchNetwork({ known: [], ...net, onFound: () => {} });
  assert.equal(net.asked.filter((a) => /^http:\/\/\d/.test(a)).length, 3 * 254);
  assert.ok(net.peak <= SCAN_CONCURRENCY, `${net.peak} requests in flight`);
  assert.ok(net.peak > 64, `only ${net.peak} in flight; the scan is not using its budget`);
});

test("the search finds a board by name", async () => {
  const net = network({ routers: ["192.168.0"], boards: { "http://fiestapi.local:4420": { id: "abcdefgh12" } } });
  const found = [];
  await searchNetwork({ known: [], ...net, onFound: (b) => found.push(b) });
  assert.equal(found[0].address, "http://fiestapi.local:4420");
});

test("the search asks a remembered board first", async () => {
  const net = network({ routers: [] });
  await searchNetwork({ known: ["http://10.9.8.7:4420"], ...net, onFound: () => {} });
  assert.equal(net.asked[0], "http://10.9.8.7:4420");
});

test("when no router answers, the fallback subnets are scanned", async () => {
  const net = network({ routers: [] });
  await searchNetwork({ known: [], ...net, onFound: () => {} });
  assert.ok(net.asked.includes("http://192.168.1.20:4420"));
  assert.ok(net.asked.includes("http://192.168.0.20:4420"));
});

test("progress counts every address asked, and finishes complete", async () => {
  const net = network({ routers: ["192.168.0"] });
  const progress = [];
  await searchNetwork({ known: [], ...net, onFound: () => {}, onProgress: (p) => progress.push(p) });
  const last = progress.at(-1);
  assert.equal(last.checked, last.total);
  assert.equal(last.total, 254 + NAMED_CANDIDATES.length);
});

test("the search reports a browser that blocks local requests instead of scanning", async () => {
  const net = network({ blocked: true });
  const result = await searchNetwork({ known: [], ...net, onFound: () => {} });
  assert.deepEqual(result, { blocked: true });
  assert.ok(!net.asked.some((a) => /^http:\/\/\d/.test(a)), "subnets were scanned anyway");
});

test("the search stops asking once aborted", async () => {
  const controller = new AbortController();
  const net = network({ routers: ["192.168.1", "192.168.0"], answerMs: 2 });
  let seen = 0;
  const identify = async (address) => {
    seen += 1;
    if (seen === 30) controller.abort();
    return net.identify(address);
  };
  await searchNetwork({ known: [], identify, reach: net.reach, onFound: () => {}, signal: controller.signal });
  // What was already in flight finishes; nothing new starts.
  assert.ok(seen <= SCAN_CONCURRENCY + 30, `asked ${seen} addresses after aborting`);
  assert.ok(seen < 2 * 254);
});

test("scanning a typed subnet reports progress up to every address", async () => {
  const net = network();
  const progress = [];
  await scanSubnet("192.168.7", { identify: net.identify, onFound: () => {}, onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress[0], { checked: 0, total: 254 });
  assert.deepEqual(progress.at(-1), { checked: 254, total: 254 });
});
