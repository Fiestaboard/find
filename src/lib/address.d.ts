export type RefusalReason = "empty" | "invalid" | "scheme" | "credentials" | "extra" | "public";
export function isLocalHost(hostname: string): boolean;
export function parseBoardAddress(input: unknown): { ok: true; address: string } | { ok: false; reason: RefusalReason };
