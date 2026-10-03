// How the find page looks for FiestaBoards on the visitor's network.
//
// There is no server. The visitor's own browser asks addresses on their
// network "are you a FiestaBoard?" and lists the ones that say yes. What to
// ask, in what order, and how to read the answers lives here; the fetches
// themselves are in probe.ts, so everything in this file runs under
// `node --test` with no browser.
//
// The order:
//   1. Addresses this browser already knows: boards opened from this page
//      before, and boards the sign-in relay at fiestaboard.app/auth remembers
//      (same origin, so the same localStorage).
//   2. Names a board answers to without any setup: fiestapi.local (the
//      Raspberry Pi image), fiestaboard.local (host networking) and the Home
//      Assistant host.
//   3. Every address on the home subnets that are actually present. Which
//      ones are present is found by asking each common router address first,
//      rather than scanning a dozen /24s blind.

import { isLocalHost, parseBoardAddress } from "./address.js";

/** The port a FiestaBoard is published on, in every supported install. */
export const BOARD_PORT = 4420;

/**
 * Every FiestaBoard answers GET /api/ with this name, without a session and
 * with `Access-Control-Allow-Origin: *`. It is how a board on any release is
 * recognised; /api/discover only adds detail and only exists from 9.9.
 */
export const IDENTIFY_PATH = "/api/";
export const API_NAME = "FiestaBoard Display API";
export const DISCOVER_PATH = "/api/discover";

/** Where boards opened from this page are remembered. */
export const STORAGE_KEY = "fiestaboard.find.boards";
/** The sign-in relay's list (Fiestaboard/auth); read here, never written. */
export const RELAY_STORAGE_KEY = "fiestaboard.oauth.boards";

const MAX_REMEMBERED = 20;

/** Names a board answers to with no setup, most likely first. */
export const NAMED_CANDIDATES = [
  `http://fiestapi.local:${BOARD_PORT}`,
  `http://fiestaboard.local:${BOARD_PORT}`,
  `http://homeassistant.local:${BOARD_PORT}`,
  // Host networking publishes nginx's own port rather than 4420.
  "http://fiestaboard.local:3000",
];

/**
 * The /24s home routers hand out, roughly most common first. Each is only
 * scanned if its router answers (see gatewayPresent).
 */
export const COMMON_SUBNETS = [
  "192.168.1", // most routers
  "192.168.0", // TP-Link, D-Link, Netgear, UniFi
  "10.0.0", // Xfinity, Apple
  "192.168.86", // Google Nest Wifi
  "192.168.68", // TP-Link Deco
  "192.168.4", // eero
  "192.168.50", // ASUS
  "192.168.178", // FRITZ!Box
  "192.168.2",
  "10.0.1", // Apple AirPort
  "192.168.10",
  "192.168.100",
  "10.1.10", // Comcast Business
  "172.16.0",
];

/** Subnets scanned when no router answers at all, rather than giving up. */
export const FALLBACK_SUBNET_COUNT = 2;
/** At most this many subnets are scanned host by host. */
export const MAX_SUBNETS = 3;

/** A request that fails faster than this never left the browser. */
export const BLOCKED_MS = 40;
/** A router that fails faster than this exists (it refused, or redirected
 *  somewhere unreadable); slower is a timeout. */
export const PRESENT_MS = 1500;

export function subnetCandidates(prefix) {
  const hosts = [];
  for (let host = 1; host <= 254; host += 1) hosts.push(`http://${prefix}.${host}:${BOARD_PORT}`);
  return hosts;
}

/** The router's usual address on a subnet; most serve a page on port 80. */
export function gatewayUrl(prefix) {
  return `http://${prefix}.1/`;
}

/**
 * Read a router probe, `{ ok, ms }`: `ok` when anything answered, else how
 * long the failure took. A quick failure still means a device is there: a
 * refused connection comes back in milliseconds, while an address nobody
 * holds is silent until the timeout.
 */
export function gatewayPresent({ ok, ms }) {
  return ok || ms < PRESENT_MS;
}

/**
 * The subnets worth scanning, in COMMON_SUBNETS order, at most MAX_SUBNETS.
 * When no router answered (some serve nothing on port 80), fall back to the
 * most common few.
 */
export function subnetsToScan(gatewayResults) {
  const present = COMMON_SUBNETS.filter(
    (prefix) => gatewayResults[prefix] && gatewayPresent(gatewayResults[prefix]),
  );
  return (present.length > 0 ? present : COMMON_SUBNETS.slice(0, FALLBACK_SUBNET_COUNT)).slice(0, MAX_SUBNETS);
}

/**
 * True when every probe was refused before it could have left the browser:
 * Safari and other browsers that do not let a secure page reach plain-http
 * local addresses, or a denied local-network permission. On a real network
 * at least some of the common subnets are empty, and those time out.
 */
export function looksBlocked(results) {
  return results.length > 0 && results.every(({ ok, ms }) => !ok && ms < BLOCKED_MS);
}

/**
 * A subnet someone typed, as a prefix: "192.168.7", "192.168.7.x" and
 * "192.168.7.0/24" all give "192.168.7". A full address ("192.168.7.20") is
 * not a subnet; it is a board to open. Only private ranges; null otherwise.
 */
export function parseSubnet(input) {
  const match = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.(?:x|\*)|\.\d{1,3}\/24)?\s*$/i.exec(String(input));
  if (!match) return null;
  const prefix = match.slice(1, 4).map(Number);
  if (prefix.some((part) => part > 255)) return null;
  const text = prefix.join(".");
  return isLocalHost(`${text}.1`) && !text.startsWith("127.") ? text : null;
}

/** True for the body every FiestaBoard returns from GET /api/. */
export function isBoardIdentity(body) {
  return Boolean(body) && typeof body === "object" && body.name === API_NAME;
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  // Shown as text by React, so this is about tidiness, not escaping.
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** The useful parts of a GET /api/discover body, or {} if it is not one. */
export function parseDiscover(body) {
  if (!body || typeof body !== "object" || body.product !== "FiestaBoard") return {};
  const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.id) ? body.id : "";
  return { id, name: cleanText(body.name, 60), version: cleanText(body.version, 32) };
}

/** Readable names are preferred over IPs when one board has both. */
function addressRank(address) {
  const host = new URL(address).hostname;
  if (host === "localhost" || host.startsWith("[")) return 2;
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 1 : 0;
}

/**
 * The board list with *found* merged in. A board seen at a second address
 * (same install id) is one entry, shown at its most readable address, with
 * the others kept in `aliases`. Boards too old to report an id are listed
 * once per address.
 */
export function addBoard(boards, found) {
  const existing = boards.find(
    (board) => board.address === found.address || (found.id && board.id === found.id),
  );
  if (!existing) return [...boards, { ...found, aliases: [] }];

  const addresses = [existing.address, ...existing.aliases, found.address].filter(
    (address, index, all) => all.indexOf(address) === index,
  );
  addresses.sort((a, b) => addressRank(a) - addressRank(b));
  const merged = {
    ...existing,
    name: existing.name || found.name || "",
    version: existing.version || found.version || "",
    id: existing.id || found.id || "",
    address: addresses[0],
    aliases: addresses.slice(1),
  };
  return boards.map((board) => (board === existing ? merged : board));
}

function parseList(raw) {
  if (typeof raw !== "string" || !raw) return [];
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const addresses = [];
  for (const entry of list) {
    const parsed = parseBoardAddress(entry);
    if (parsed.ok && !addresses.includes(parsed.address)) addresses.push(parsed.address);
    if (addresses.length === MAX_REMEMBERED) break;
  }
  return addresses;
}

/**
 * Addresses this browser knows, this page's own list first. Anything that is
 * not a local address is dropped, so a value planted in storage cannot point
 * the page at the internet.
 */
export function knownAddresses(findRaw, relayRaw) {
  const own = parseList(findRaw);
  return [...own, ...parseList(relayRaw).filter((address) => !own.includes(address))];
}

/** This page's stored list with *address* added, most recent first. */
export function rememberAddress(raw, address) {
  const parsed = parseBoardAddress(address);
  const list = parseList(raw);
  if (!parsed.ok) return JSON.stringify(list);
  return JSON.stringify([parsed.address, ...list.filter((a) => a !== parsed.address)].slice(0, MAX_REMEMBERED));
}

/**
 * True for this computer's own addresses. Chrome guards those with a second
 * permission ("loopback network"), separate from the local network one, so
 * asking them would put a second question in front of the visitor partway
 * through. A board running on this computer is found at its network address
 * instead, since Docker publishes the port on every interface.
 */
export function isLoopback(address) {
  try {
    const host = new URL(address).hostname;
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host.startsWith("127.");
  } catch {
    return false;
  }
}

/**
 * Everything to ask in the first pass: known addresses, then the names a
 * board answers to with no setup. Deduplicated, order kept, never loopback.
 */
export function firstPassCandidates(known) {
  return [...known, ...NAMED_CANDIDATES].filter(
    (address, index, all) => all.indexOf(address) === index && !isLoopback(address),
  );
}

/**
 * Where on the board to land, from `?to=`. Docs link to
 * fiestaboard.app/find?to=/settings so a reader lands on the right page of
 * their own board. Only a plain path on the board is accepted: never
 * another host ("//evil", "/\\evil"), never a scheme.
 */
export function destinationPath(search) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const to = params.get("to");
  if (!to || to.length > 200) return "";
  if (!/^\/(?![/\\])[A-Za-z0-9\-._~/%?=&]*$/.test(to)) return "";
  return to === "/" ? "" : to;
}

/** The link that opens *address*, at *path* on it. */
export function boardUrl(address, path) {
  return `${address}${path || "/"}`;
}

/**
 * Read an address someone typed into the form. Unlike probing, opening a
 * link the visitor typed themselves is harmless wherever it points, so
 * public addresses are allowed here (a board behind a reverse proxy).
 */
export function parseTypedAddress(input) {
  const local = parseBoardAddress(input);
  if (local.ok || local.reason !== "public") return local;
  const text = String(input).trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  return { ok: true, address: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}` };
}

/** True when *address* may be probed: only local addresses ever are. */
export function mayProbe(address) {
  try {
    return isLocalHost(new URL(address).hostname);
  } catch {
    return false;
  }
}

/**
 * At most *max* tasks in flight at once, shared by everyone holding the
 * returned function. `run(task)` resolves with the task's result once it
 * has had its turn.
 */
export function limiter(max) {
  let active = 0;
  const waiting = [];
  const next = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return (task) =>
    new Promise((resolve, reject) => {
      const start = () => {
        active += 1;
        Promise.resolve().then(task).then(resolve, reject).finally(next);
      };
      if (active < max) start();
      else waiting.push(start);
    });
}

/**
 * How many addresses are asked at once, across every subnet being scanned.
 * Empty addresses never answer and each holds its slot until the timeout,
 * so this sets how many timeouts a scan waits through: 254 addresses at 192
 * is two. Chrome allows 256 connections per profile, and the page needs a
 * few of those for itself.
 */
export const SCAN_CONCURRENCY = 192;

/**
 * Ask every address on *prefix*.x.
 *
 *   identify(address) -> Promise<found | null>
 *   onFound(found)     a board answered
 *   onProgress({ checked, total })
 */
export async function scanSubnet(prefix, { identify, onFound, onProgress, signal }) {
  const run = limiter(SCAN_CONCURRENCY);
  const hosts = subnetCandidates(prefix);
  let checked = 0;
  onProgress?.({ checked, total: hosts.length });
  await Promise.all(
    hosts.map((address) =>
      run(async () => {
        if (signal?.aborted) return;
        const found = await identify(address);
        checked += 1;
        if (signal?.aborted) return;
        if (found) onFound(found);
        onProgress?.({ checked, total: hosts.length });
      }),
    ),
  );
}

/**
 * The whole search. Resolves to { blocked } once every step has run or
 * *signal* aborted; boards are reported through onFound as they answer.
 *
 * Nothing waits that does not have to. Known addresses and well-known names
 * are asked straight away. A subnet is scanned the moment its router
 * answers, which on a real network is within milliseconds; only routers
 * that never answer cost the full router timeout, and only when no router
 * answers at all does the search wait for them.
 *
 *   known              addresses this browser remembers (knownAddresses)
 *   identify(address)  -> Promise<found | null>
 *   reach(url)         -> Promise<{ ok, ms }>, for routers
 *   onProgress({ checked, total })  total grows as subnets are added
 */
export async function searchNetwork({ known, identify, reach, onFound, onProgress, signal }) {
  const run = limiter(SCAN_CONCURRENCY);
  let checked = 0;
  let total = 0;
  let foundAny = false;

  const ask = (address) => {
    total += 1;
    return run(async () => {
      if (signal?.aborted) return;
      const found = await identify(address);
      checked += 1;
      if (signal?.aborted) return;
      if (found) {
        foundAny = true;
        onFound(found);
      }
      onProgress?.({ checked, total });
    });
  };

  const scans = [];
  const scanned = new Set();
  const scan = (prefix) => {
    if (signal?.aborted || scanned.has(prefix) || scanned.size >= MAX_SUBNETS) return;
    scanned.add(prefix);
    scans.push(Promise.all(subnetCandidates(prefix).map(ask)));
    onProgress?.({ checked, total });
  };

  const firstPass = Promise.all(firstPassCandidates(known).filter(mayProbe).map(ask));
  onProgress?.({ checked, total });

  const gateways = {};
  await Promise.all(
    COMMON_SUBNETS.map(async (prefix) => {
      gateways[prefix] = await reach(gatewayUrl(prefix));
      // An answer is proof enough to start now. A quick failure might be a
      // router refusing or a browser blocking everything; that is only
      // decidable once every router has been asked.
      if (gateways[prefix].ok) scan(prefix);
    }),
  );

  if (looksBlocked(Object.values(gateways))) {
    await firstPass;
    if (!foundAny && !signal?.aborted) return { blocked: true };
  } else {
    for (const prefix of subnetsToScan(gateways)) scan(prefix);
  }

  await firstPass;
  await Promise.all(scans);
  return { blocked: false };
}
