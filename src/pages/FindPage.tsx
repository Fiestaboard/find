/**
 * fiestaboard.app/find: look for FiestaBoards on the visitor's network and
 * open one.
 *
 * The prerendered HTML is the "idle" view, so the first client render must be
 * that too; anything that depends on the browser is read in an effect.
 */
import {
  ActionCard,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  CardContent,
  CardFooter,
  Code,
  Field,
  FiestaIcon,
  Flex,
  Input,
  List,
  ListItem,
  Spinner,
  Stack,
  Text,
  TextLink,
} from "../ui";
import { ChevronRight, Radar, SearchX, ShieldOff, WifiOff } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import {
  type ListedBoard,
  type Stage,
  NAMED_CANDIDATES,
  addBoard,
  boardUrl,
  destinationPath,
  gatewayUrl,
  COMMON_SUBNETS,
  knownAddresses,
  mayProbe,
  parseSubnet,
  parseTypedAddress,
  rememberAddress,
  scanSubnet,
  searchNetwork,
} from "../lib/discovery.js";
import { askForNetworkAccess, identify, networkPermission, reach } from "../lib/probe";
import { readRelayRemembered, readRemembered, writeRemembered } from "../lib/storage";
import { PageHeading, Shell } from "./Shell";

type Phase = "idle" | "asking" | "searching" | "done" | "blocked" | "denied";

const TYPED_ERRORS: Record<string, string> = {
  empty: "Type your board's address, or a network range like 192.168.7.x.",
  credentials: "Leave out any username or password.",
  scheme: "Use an address that starts with http:// or https://.",
  extra: "Leave out anything after a ? or #.",
  invalid: "That doesn't look like an address.",
};

function heading(phase: Phase, count: number): { title: string; description?: string; icon?: ReactNode } {
  switch (phase) {
    case "idle":
      return {
        title: "Find your FiestaBoard",
        description: "Look for FiestaBoards on the network this device is connected to, and open yours.",
      };
    case "asking":
      return {
        title: "Allow this page to look around your network",
        description: "Your browser is asking whether fiestaboard.app may look for devices on your network. Choose Allow.",
        icon: <Radar />,
      };
    case "searching":
      return { title: "Looking for your FiestaBoard…", icon: <Spinner size="lg" label={null} /> };
    case "done":
      return count > 0
        ? { title: count === 1 ? "Found your FiestaBoard" : `Found ${count} FiestaBoards` }
        : { title: "No FiestaBoard found", icon: <SearchX /> };
    case "blocked":
      return {
        title: "This browser can't search your network",
        description: "Browsers other than Chrome and Edge don't let a website look for devices on your network.",
        icon: <WifiOff />,
      };
    case "denied":
      return {
        title: "Network access wasn't allowed",
        description: "It needs your browser's permission to look for devices on your network.",
        icon: <ShieldOff />,
      };
  }
}

function progressText(stage: Stage | null): string {
  if (!stage || stage.stage === "nearby") return "Checking the usual places…";
  return `Checking ${stage.prefix}.x · ${stage.checked} of ${stage.total}`;
}

/** Hostname and port, without the http:// a person does not need to read. */
function shortAddress(address: string): string {
  return address.replace(/^http:\/\//, "");
}

export function FindPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [boards, setBoards] = useState<ListedBoard[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [destination, setDestination] = useState("");
  const [known, setKnown] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState("");
  const search = useRef<AbortController | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  // Only after hydration: storage, the query string and permissions.
  useEffect(() => {
    setDestination(destinationPath(window.location.search));
    setKnown(knownAddresses(readRemembered(), readRelayRemembered()));
    // A returning visitor who already allowed access does not need the
    // button.
    void networkPermission().then((state) => {
      if (state === "granted" && !started.current) void start();
    });
    return () => search.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function show(next: Phase) {
    setPhase(next);
    if (next !== "searching") requestAnimationFrame(() => title.current?.focus());
  }

  const found = (board: { address: string; id: string; name: string; version: string }) =>
    setBoards((list) => addBoard(list, board));

  async function start() {
    started.current = true;
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;

    if ((await networkPermission()) === "prompt") {
      show("asking");
      const answer = await askForNetworkAccess(gatewayUrl(COMMON_SUBNETS[0]));
      if (answer === "denied") return show("denied");
    }
    if (controller.signal.aborted) return;

    setStage(null);
    show("searching");
    const result = await searchNetwork({
      known: knownAddresses(readRemembered(), readRelayRemembered()),
      identify: (address) => identify(address, controller.signal),
      reach: (url) => reach(url, controller.signal),
      onFound: found,
      onStage: setStage,
      signal: controller.signal,
    });
    if (search.current !== controller) return;
    if (result.blocked) {
      // Chrome and Edge know the permission; there, every request failing
      // means it was refused or the question was dismissed, and the fix is
      // in the browser's site settings rather than another browser.
      show((await networkPermission()) === "unsupported" ? "blocked" : "denied");
    } else {
      show("done");
    }
  }

  function stop() {
    search.current?.abort();
    show("done");
  }

  async function scanTypedSubnet(prefix: string) {
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    setStage({ stage: "subnet", prefix, checked: 0, total: 254 });
    show("searching");
    await scanSubnet(prefix, {
      identify: (address) => identify(address, controller.signal),
      onFound: found,
      onProgress: (progress) => setStage({ stage: "subnet", ...progress }),
      signal: controller.signal,
    });
    if (search.current === controller) show("done");
  }

  function remember(address: string) {
    writeRemembered(rememberAddress(readRemembered(), address));
  }

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    const prefix = parseSubnet(typed);
    if (prefix) {
      setTypedError("");
      void scanTypedSubnet(prefix);
      return;
    }
    const parsed = parseTypedAddress(typed);
    if (!parsed.ok) {
      setTypedError(TYPED_ERRORS[parsed.reason] ?? TYPED_ERRORS.invalid);
      return;
    }
    setTypedError("");
    if (mayProbe(parsed.address)) remember(parsed.address);
    window.location.assign(boardUrl(parsed.address, destination));
  }

  const { title: titleText, description, icon } = heading(phase, boards.length);
  const searching = phase === "searching" || phase === "asking";

  return (
    <Shell>
      <PageHeading ref={title} icon={icon} description={description}>
        {titleText}
      </PageHeading>

      <CardContent>
        <Stack gap="5">
          {destination && (
            <Text size="sm" tone="muted">
              Then you'll go to <Code>{destination}</Code> on it.
            </Text>
          )}

          {phase === "idle" && (
            <Stack gap="4">
              <Text>
                This page asks the devices on your network whether they're a FiestaBoard. Nothing leaves your
                network, and nothing is stored anywhere but this browser.
              </Text>
              <Button variant="brand" size="lg" className="w-full" onClick={() => void start()}>
                <Radar aria-hidden="true" />
                Search my network
              </Button>
              <Text size="xs" tone="muted">
                Chrome and Edge ask first whether this page may look for devices on your network.
              </Text>
            </Stack>
          )}

          {searching && (
            <Flex align="center" justify="between" gap="3">
              <Text size="sm" tone="muted" className="tabular-nums">
                {phase === "asking" ? "Waiting for your answer…" : progressText(stage)}
              </Text>
              <Button variant="outline" size="sm" onClick={stop}>
                Stop
              </Button>
            </Flex>
          )}

          {boards.length > 0 && (
            <List gap="2" aria-label="FiestaBoards found">
              {boards.map((board) => (
                <ListItem key={board.address}>
                  <ActionCard
                    asChild
                    icon={<FiestaIcon size={20} />}
                    tone="primary"
                    title={board.name || shortAddress(board.address)}
                    description={[
                      board.name ? shortAddress(board.address) : "FiestaBoard",
                      board.aliases.length > 0 && `also ${board.aliases.map(shortAddress).join(", ")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    meta={
                      <Flex align="center" gap="2">
                        {board.version && <Badge variant="outline">v{board.version}</Badge>}
                        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                      </Flex>
                    }
                  >
                    <a href={boardUrl(board.address, destination)} onClick={() => remember(board.address)} />
                  </ActionCard>
                </ListItem>
              ))}
            </List>
          )}

          {/* Mounted for the page's whole life so changes are announced. */}
          <Text role="status" aria-live="polite" className="sr-only">
            {boards.length === 0 ? "" : boards.length === 1 ? "Found 1 FiestaBoard" : `Found ${boards.length} FiestaBoards`}
          </Text>

          {phase === "done" && boards.length === 0 && (
            <Stack gap="3">
              <List as="ul" marker="disc" gap="2" className="text-sm">
                <ListItem>Check that this device is on the same Wi-Fi as your board, not a guest network.</ListItem>
                <ListItem>A board that was just switched on can take a couple of minutes to start.</ListItem>
                <ListItem>
                  Your router's list of connected devices shows the board's address. Type it below, or your network's
                  range, like <Code>192.168.7.x</Code>.
                </ListItem>
              </List>
            </Stack>
          )}

          {phase === "blocked" && (
            <Stack gap="3">
              <Text>Open this page in Chrome or Edge to search automatically, or try where boards usually are:</Text>
              <List gap="1" className="text-sm">
                {[...known, ...NAMED_CANDIDATES.slice(0, 3)]
                  .filter((address, index, all) => all.indexOf(address) === index)
                  .map((address) => (
                    <ListItem key={address}>
                      <TextLink href={boardUrl(address, destination)}>{shortAddress(address)}</TextLink>
                    </ListItem>
                  ))}
              </List>
            </Stack>
          )}

          {phase === "denied" && (
            <Alert variant="warning">
              <ShieldOff aria-hidden="true" />
              <AlertTitle>To allow it</AlertTitle>
              <AlertDescription>
                Select the icon at the left of the address bar, open Site settings, and set Local network access to
                Allow. Then search again, and choose Allow if your browser asks.
              </AlertDescription>
            </Alert>
          )}

          {(phase === "done" || phase === "denied") && (
            <Button variant={boards.length > 0 ? "outline" : "brand"} className="w-full" onClick={() => void start()}>
              Search again
            </Button>
          )}
        </Stack>
      </CardContent>

      <CardFooter className="block border-t pt-5">
        <form onSubmit={submitTyped} noValidate>
          <Stack gap="3">
            <Field
              label="Know the address?"
              description="Like 192.168.1.50:4420, or a range like 192.168.7.x to search it."
              error={typedError || undefined}
            >
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Button type="submit" variant="secondary" className="w-full sm:w-auto sm:self-end">
              Go
            </Button>
          </Stack>
        </form>
      </CardFooter>
    </Shell>
  );
}
