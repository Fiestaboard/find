# Find your FiestaBoard

One static page, served from GitHub Pages at **https://fiestaboard.app/find/**, that looks for
[FiestaBoards](https://github.com/Fiestaboard/FiestaBoard) on the visitor's home network and
opens the one they pick. Send someone there when they don't know their board's address.

## Linking to it

- `https://fiestaboard.app/find/` finds the board and opens its home page.
- `https://fiestaboard.app/find/?to=/settings` opens that page on the board instead. Docs can
  link to a page on "your board" this way. `to` must be a path on the board: anything that
  could point at another host is ignored.

## How it works

There is no server. The visitor's own browser asks addresses on their network "are you a
FiestaBoard?" and lists the ones that say yes:

1. **Addresses this browser already knows:** boards opened from this page before, and boards
   the [sign-in relay](https://github.com/Fiestaboard/auth) at `fiestaboard.app/auth` remembers
   (same origin, so the same `localStorage`).
2. **Names a board answers to with no setup:** `fiestapi.local` (the Raspberry Pi image),
   `fiestaboard.local` (Docker with host networking), and `homeassistant.local`.
3. **Every address on the home subnets that exist.** The page asks the usual router address
   (`.1`) on about a dozen common subnets (`192.168.1.x`, `192.168.0.x`, `10.0.0.x`, …). A
   subnet is scanned the moment its router answers, without waiting for the others to time
   out. A router that refuses quickly also counts as present, once every router has been
   asked. At most three subnets are scanned, 254 addresses each, on port 4420.

All three steps start at once and share one pool of up to 192 requests in flight. An empty
address never answers, so the scan's length is mostly how many timeouts it waits through:
1.5 s each for IP addresses (a board answers in milliseconds) and 2.5 s for names, whose
`.local` lookup takes longer. On a typical network the first board appears within a fraction
of a second, and the whole search takes about three seconds.

A board is shown as soon as it answers, and the search carries on underneath it. The status
line describes the search ("Looking around your network…") rather than the addresses being
tried.

A board is recognised by `GET /api/`, which every FiestaBoard release answers without a
session and with `Access-Control-Allow-Origin: *`. Boards from 9.9 on also answer
`GET /api/discover` with their version, their name (only while sign-in is off), and a random
install id. The id lets the page list a board once when it is reachable at both its IP and a
`.local` name.

The page can't learn the visitor's own IP address (browsers hide it), which is why it checks
for routers rather than scanning one known subnet. Anyone on an unusual range can type it
(`192.168.7.x`) into the form at the bottom.

### Browser support

The page is served over HTTPS and boards answer over plain HTTP on the local network.

- **Chrome and Edge 142+** allow this once the visitor grants the *local network access*
  permission. The page asks for it with the first request and waits for the answer. Chrome
  guards `localhost` with a second, separate permission, so the page never probes this
  computer's own addresses. A board running in Docker on the same computer is found at its
  LAN address instead.
- **Safari and Firefox** refuse such requests outright. The page notices that every request
  failed before it could leave the browser, and offers links to the usual addresses and the
  address form instead.

## Privacy and security

- **Only local addresses are ever probed**, by the same rules as the sign-in relay
  ([`src/lib/address.js`](src/lib/address.js)). A remembered address that is not local is
  dropped when read, so a value planted in storage cannot point the page at the internet.
- **Nothing leaves the visitor's network.** No analytics, no third-party code. The responses
  are read in the browser and only the list of boards opened is kept, in `localStorage`.
- **Nothing is probed until the visitor presses the button**, unless they have already
  granted Chrome's permission to this site.
- **The Content-Security-Policy is the relay's, plus `connect-src http: https:`.** That is
  the one thing this page exists to do. CSP cannot say "private addresses only";
  `mayProbe()` does, and is tested.

## How it is built

A React component using [FiestaUI](https://github.com/Fiestaboard/FiestaUI)
(`@fiestaboard/ui`), prerendered to static HTML at build time and hydrated in the browser,
the same way as the sign-in relay.

- `src/lib/discovery.js` decides what to ask and how to read the answers. It is
  dependency-free with no DOM access, so `node --test` covers the whole search against a fake
  network.
- `src/lib/probe.ts` makes the requests, with timeouts and Chrome's permission.
- `src/pages/FindPage.tsx` is the page. `src/prerender.tsx` and `scripts/prerender.mjs`
  render it into the built HTML.

## Development

```sh
npm install
npm test          # unit tests for the address rules and the search
npm run dev       # dev server with hot reload
npm run build     # typecheck, build and prerender into dist/
npm run test:dist # invariants of the built site (CSP, no inline code)
npm run preview   # serve dist/ at http://localhost:8787
```

Served from `localhost`, the page is not subject to Chrome's local network checks. To test
what visitors to fiestaboard.app get, serve `dist/` over HTTPS and start Chrome with
`--ip-address-space-overrides=127.0.0.1:<port>=public`, so the page counts as a public site.

## Deployment

Pushing to `main` runs the tests, builds the site, and deploys `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). Because the organisation's site uses the custom domain
`fiestaboard.app`, this repository is published under `https://fiestaboard.app/find/` with
that site's certificate. This repository must not set a custom domain of its own.

## License

MIT. See [LICENSE](LICENSE).
