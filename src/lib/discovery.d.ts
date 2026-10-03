// Types for discovery.js, which stays plain JavaScript so `node --test`
// runs it with no build step.

export const BOARD_PORT: number;
export const IDENTIFY_PATH: string;
export const API_NAME: string;
export const DISCOVER_PATH: string;
export const STORAGE_KEY: string;
export const RELAY_STORAGE_KEY: string;
export const NAMED_CANDIDATES: string[];
export const COMMON_SUBNETS: string[];
export const FALLBACK_SUBNET_COUNT: number;
export const MAX_SUBNETS: number;
export const BLOCKED_MS: number;
export const PRESENT_MS: number;
export const SCAN_CONCURRENCY: number;

export type Reach = { ok: boolean; ms: number };
export type FoundBoard = { address: string; id: string; name: string; version: string };
export type ListedBoard = FoundBoard & { aliases: string[] };
export type Stage = { stage: "nearby" } | { stage: "subnet"; prefix: string; checked: number; total: number };

export function subnetCandidates(prefix: string): string[];
export function gatewayUrl(prefix: string): string;
export function gatewayPresent(result: Reach): boolean;
export function subnetsToScan(results: Record<string, Reach>): string[];
export function looksBlocked(results: Reach[]): boolean;
export function parseSubnet(input: unknown): string | null;
export function isBoardIdentity(body: unknown): boolean;
export function parseDiscover(body: unknown): Partial<Pick<FoundBoard, "id" | "name" | "version">>;
export function addBoard(boards: ListedBoard[], found: FoundBoard): ListedBoard[];
export function knownAddresses(findRaw: unknown, relayRaw: unknown): string[];
export function rememberAddress(raw: unknown, address: string): string;
export function isLoopback(address: string): boolean;
export function firstPassCandidates(known: string[]): string[];
export function destinationPath(search: unknown): string;
export function boardUrl(address: string, path: string): string;
export function parseTypedAddress(
  input: unknown,
): { ok: true; address: string } | { ok: false; reason: "empty" | "invalid" | "scheme" | "credentials" | "extra" | "public" };
export function mayProbe(address: string): boolean;
export function pool<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void>;
export function scanSubnet(
  prefix: string,
  options: {
    identify: (address: string) => Promise<FoundBoard | null>;
    onFound: (found: FoundBoard) => void;
    onProgress?: (progress: { prefix: string; checked: number; total: number }) => void;
    signal?: AbortSignal;
  },
): Promise<void>;
export function searchNetwork(options: {
  known: string[];
  identify: (address: string) => Promise<FoundBoard | null>;
  reach: (url: string) => Promise<Reach>;
  onFound: (found: FoundBoard) => void;
  onStage?: (stage: Stage) => void;
  signal?: AbortSignal;
}): Promise<{ blocked: boolean }>;
