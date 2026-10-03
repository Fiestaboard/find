// What counts as an address on a local network.
//
// The same rules as Fiestaboard/auth (src/lib/board-address.js): the find
// page only ever probes, remembers or links to addresses that pass
// isLocalHost(), so a crafted link cannot turn it into a tool for poking at
// hosts on the public internet. Keep the two copies in step.
//
// No DOM access in here, so `node --test` can exercise it.

// Hostname suffixes that only ever resolve on a local network.
//   .local      mDNS (RFC 6762)          e.g. fiestaboard.local
//   .localhost  loopback (RFC 6761)
//   .home.arpa  residential (RFC 8375)
//   .internal   private-use (ICANN, 2024)
//   .lan        not reserved, but not delegated either; common router default
const LOCAL_SUFFIXES = [".local", ".localhost", ".home.arpa", ".internal", ".lan"];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateIPv4(host) {
  const match = IPV4.exec(host);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT (Tailscale)
  return false;
}

function isPrivateIPv6(host) {
  // URL.hostname keeps the brackets and gives the compressed lowercase form.
  if (!host.startsWith("[") || !host.endsWith("]")) return false;
  const address = host.slice(1, -1);
  if (address === "::1") return true; // loopback
  return /^f[cd][0-9a-f]{2}:/.test(address); // fc00::/7 unique local
}

function isLocalName(host) {
  if (host === "localhost") return true;
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) {
    return true;
  }
  // A single-label name ("fiestaboard", "raspberrypi") can only be answered
  // by the local resolver; there is no such thing on the public internet.
  // All-numeric labels are excluded: the URL parser has already turned those
  // into IPv4 addresses, so one reaching here would be something odd.
  return /^(?=.*[a-z])[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(host);
}

export function isLocalHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  // Anything that looks like a dotted quad must BE a private address; never
  // fall through to the name rules with it.
  if (IPV4.test(host)) return isPrivateIPv4(host);
  if (host.startsWith("[")) return isPrivateIPv6(host);
  return isLocalName(host);
}

/**
 * Validate and normalise a board address typed by a person or passed in a
 * link.
 *
 * Returns { ok: true, address } with a normalised address (scheme, host,
 * optional port, optional path prefix, no trailing slash), or
 * { ok: false, reason } where reason is one of:
 *   "empty" | "invalid" | "scheme" | "credentials" | "extra" | "public"
 */
export function parseBoardAddress(input) {
  if (typeof input !== "string") return { ok: false, reason: "invalid" };
  let text = input.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > 2048) return { ok: false, reason: "invalid" };

  // Let people type "192.168.1.50:4420" the way it appears on their router.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // "javascript:alert(1)" and friends have a scheme but no "//".
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return { ok: false, reason: "scheme" };
    text = `http://${text}`;
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.search || url.hash || text.includes("?") || text.includes("#")) {
    return { ok: false, reason: "extra" };
  }
  // Backslashes are path separators to the URL parser but not to people;
  // refuse rather than guess which was meant.
  if (text.includes("\\")) return { ok: false, reason: "invalid" };
  if (!isLocalHost(url.hostname)) return { ok: false, reason: "public" };

  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, address: `${url.protocol}//${url.host}${path}` };
}
