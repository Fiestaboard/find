// The network calls behind discovery.js: asking one address whether it is a
// FiestaBoard, and whether anything at all is at a router's address.
//
// The page is served over HTTPS and boards answer over plain HTTP on the
// local network. Chrome and Edge (142+) allow that once the visitor grants
// the "local network access" permission; browsers without that permission
// refuse the request outright, which discovery.js recognises as "blocked".

import { DISCOVER_PATH, IDENTIFY_PATH, isBoardIdentity, parseDiscover } from "./discovery.js";

export type Found = { address: string; id: string; name: string; version: string };

const IDENTIFY_TIMEOUT_MS = 2500;
const REACH_TIMEOUT_MS = 2000;

// Chrome recognises private IP literals, .local names and localhost as local
// on its own. Any other name (fiestaboard.lan, a bare hostname) has to be
// declared, or the request is blocked as mixed content.
function addressSpace(hostname: string): "local" | undefined {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[")) return undefined;
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".localhost")) return undefined;
  return "local";
}

// `targetAddressSpace` is Chrome's Local Network Access option; other
// browsers ignore it.
type LocalRequestInit = RequestInit & { targetAddressSpace?: "local" };

async function timedFetch(url: string, init: LocalRequestInit, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, ms: performance.now() - started };
  } catch {
    return { response: null, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function readJson(response: Response | null): Promise<unknown> {
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** The board at *address*, or null when nothing there is a FiestaBoard. */
export async function identify(address: string, signal?: AbortSignal): Promise<Found | null> {
  const init: LocalRequestInit = {
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    targetAddressSpace: addressSpace(new URL(address).hostname),
  };
  const identity = await timedFetch(`${address}${IDENTIFY_PATH}`, init, IDENTIFY_TIMEOUT_MS, signal);
  if (!isBoardIdentity(await readJson(identity.response))) return null;

  // 9.9 and later say more about themselves; earlier boards (or ones that
  // require sign-in for unknown routes) just do not, and are listed anyway.
  const detail = await timedFetch(`${address}${DISCOVER_PATH}`, init, IDENTIFY_TIMEOUT_MS, signal);
  return { address, id: "", name: "", version: "", ...parseDiscover(await readJson(detail.response)) };
}

/** Whether anything answered at *url*, and how long it took to find out. */
export async function reach(url: string, signal?: AbortSignal): Promise<{ ok: boolean; ms: number }> {
  const { response, ms } = await timedFetch(
    url,
    {
      mode: "no-cors",
      credentials: "omit",
      cache: "no-store",
      // no-cors requests must follow redirects. A router that redirects to
      // an HTTPS admin page with a certificate the browser rejects fails
      // fast, which gatewayPresent() still counts as present.
      referrerPolicy: "no-referrer",
    },
    REACH_TIMEOUT_MS,
    signal,
  );
  return { ok: response !== null, ms };
}

export type NetworkPermission = "granted" | "denied" | "prompt" | "unsupported";

/**
 * The state of Chrome's local network permission. Its name changed while it
 * was being built, so both are tried; "unsupported" in every other browser.
 */
export async function networkPermission(): Promise<NetworkPermission> {
  for (const name of ["local-network-access", "local-network"]) {
    try {
      const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
      return status.state;
    } catch {
      // Not a permission this browser knows; try the next name.
    }
  }
  return "unsupported";
}

/**
 * Make the first local request, which is what makes Chrome ask for the
 * permission, and wait for the answer. Requests made while the question is
 * open would only time out, so the search starts after this resolves.
 *
 * Chrome holds the request until the question is answered. Where no question
 * is asked (a page on this computer, or access granted by policy) the request
 * just settles and the state never leaves "prompt", so that ends the wait
 * too. It carries no timeout of its own for the same reason.
 */
export async function askForNetworkAccess(url: string): Promise<NetworkPermission> {
  const controller = new AbortController();
  let settled = false;
  fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store", signal: controller.signal })
    .catch(() => undefined)
    .finally(() => {
      settled = true;
    });
  const deadline = Date.now() + 120_000;
  let state = await networkPermission();
  while (state === "prompt" && !settled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = await networkPermission();
  }
  controller.abort();
  return state;
}
