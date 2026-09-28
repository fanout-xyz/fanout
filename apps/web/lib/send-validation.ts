import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { formatUsd, parseUsd } from "./money";

export type SendInput = { amount: string; to: string };
export type SendCheck =
  | { ok: true; amount: bigint; to: Address }
  | { ok: false; errors: { amount?: string; to?: string } };

/** Payee-facing checks for Send. Copy avoids crypto terms; the address is the one thing shown as-is. */
export function checkSend(input: SendInput, balance: bigint, self?: Address, decimals?: number): SendCheck {
  const errors: { amount?: string; to?: string } = {};

  const amount = input.amount.trim() ? parseUsd(input.amount, decimals) : null;
  if (!input.amount.trim()) errors.amount = "Enter how much to send.";
  else if (amount === null) errors.amount = "Enter an amount in dollars, like 25.00.";
  else if (amount <= 0n) errors.amount = "Enter an amount more than $0.00.";
  else if (amount > balance) errors.amount = `You have ${formatUsd(balance, decimals)}. Enter that or less.`;

  const raw = input.to.trim();
  let to: Address | null = null;
  if (!raw) errors.to = "Paste the address you're sending to.";
  else if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) errors.to = "That doesn't look like an address. It starts with 0x and has 42 characters.";
  else if (!isAddress(raw)) errors.to = "That address has a typo. Copy it again from the person you're paying.";
  else {
    to = getAddress(raw);
    if (to === zeroAddress) errors.to = "That address can't receive money.";
    else if (self && to === getAddress(self)) errors.to = "That's your own account. Paste someone else's address.";
  }

  if (errors.amount || errors.to || amount === null || to === null) return { ok: false, errors };
  return { ok: true, amount, to };
}

/** 0x1234…AbCd (checksummed when valid), for confirmations and history. */
export function shortAddress(address: string): string {
  const a = isAddress(address, { strict: false }) ? getAddress(address) : address;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
