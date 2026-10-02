import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { config } from "@/lib/config";
import { formatUsd, parseUsd } from "@/lib/money";
import { WALLET_ORIGIN } from "@/lib/site-url";

/**
 * "Pay me" requests: who to pay, and optionally how much and what for. Shared as a link
 * (https://wallet.fanout.tech/pay?to=0x…&amount=20.00&note=Lunch) so any phone camera that scans
 * its QR opens a ready-to-confirm payment. Nothing here moves money: the payer always reviews the
 * full address and amount before sending.
 */
export type PaymentRequest = { to: Address; amount?: bigint; note?: string };

const NOTE_MAX = 80;

/** Notes travel inside links and QR codes: one short line, and nothing that looks like a link. */
export function cleanRequestNote(note: string | null | undefined): string | undefined {
  const flat = note?.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  if (!flat || /https?:\/\/|www\./i.test(flat)) return undefined;
  return flat;
}

/** Where pay links point: wallet.fanout.tech on any fanout.tech page, else this site (localhost, previews). */
export function walletBase(location: { hostname: string; origin: string }): string {
  const { hostname } = location;
  return hostname === "fanout.tech" || hostname.endsWith(".fanout.tech") ? WALLET_ORIGIN : location.origin;
}

export function payLink(base: string, req: PaymentRequest): string {
  const url = new URL("/pay", base);
  url.searchParams.set("to", req.to);
  if (req.amount && req.amount > 0n) url.searchParams.set("amount", formatUsd(req.amount).replace(/[$,]/g, ""));
  const note = cleanRequestNote(req.note);
  if (note) url.searchParams.set("note", note);
  return url.toString();
}

function address(raw: string | null | undefined): Address | null {
  if (!raw || !isAddress(raw, { strict: false })) return null;
  const a = getAddress(raw);
  return a === zeroAddress ? null : a;
}

/** Reads a request from query parameters (the /pay page). */
export function requestFromParams(params: { get(name: string): string | null }): PaymentRequest | null {
  const to = address(params.get("to"));
  if (!to) return null;
  const rawAmount = params.get("amount");
  const amount = rawAmount ? parseUsd(rawAmount) : null;
  return {
    to,
    ...(amount && amount > 0n ? { amount } : {}),
    ...(cleanRequestNote(params.get("note")) ? { note: cleanRequestNote(params.get("note")) } : {}),
  };
}

/**
 * Whatever a QR code or a pasted text holds, as a request:
 * - a Fanout pay link (…/pay?to=…&amount=…&note=…)
 * - a plain address (0x…)
 * - an `ethereum:` payment URI (EIP-681): `ethereum:0x…`, or an AUSD transfer
 *   `ethereum:<AUSD>@10143/transfer?address=0x…&uint256=…`
 */
export function parsePaymentRequest(text: string): PaymentRequest | null {
  const raw = text.trim();
  if (!raw) return null;

  const plain = address(raw);
  if (plain && /^0x[0-9a-fA-F]{40}$/.test(raw)) return { to: plain };

  if (/^ethereum:/i.test(raw)) {
    const m = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/(\w+))?(?:\?(.*))?$/i.exec(raw);
    if (!m) return null;
    const [, target, , fn, query] = m;
    const params = new URLSearchParams(query ?? "");
    if (!fn) return address(target) ? { to: address(target)! } : null;
    const token = config.stablecoin.address;
    if (fn.toLowerCase() !== "transfer" || !token || target.toLowerCase() !== token.toLowerCase()) return null;
    const to = address(params.get("address"));
    if (!to) return null;
    const units = params.get("uint256");
    const amount = units && /^\d+$/.test(units) ? BigInt(units) : undefined;
    return { to, ...(amount ? { amount } : {}) };
  }

  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || !/\/pay\/?$/.test(url.pathname)) return null;
    return requestFromParams(url.searchParams);
  } catch {
    return null;
  }
}
