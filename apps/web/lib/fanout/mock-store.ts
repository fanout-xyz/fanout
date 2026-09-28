import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyState, type MockState } from "./mock-engine";
import { fromWire, toWire } from "./wire";

/**
 * Server-side home of the mock state: one copy per dev server, shared by every
 * device that reaches it (laptop, phone over the tunnel). Saved to
 * .data/fanout-mock.json (gitignored) so restarts and hot reloads keep it.
 */

const FILE = path.join(process.cwd(), ".data", "fanout-mock.json");

// Survive Next's module reloads in dev by hanging the state off globalThis.
const g = globalThis as typeof globalThis & { __fanoutMock?: MockState };

export function getMockState(): MockState {
  if (!g.__fanoutMock) {
    try {
      g.__fanoutMock = fromWire<MockState>(readFileSync(FILE, "utf8"));
    } catch {
      g.__fanoutMock = emptyState();
    }
  }
  return g.__fanoutMock;
}

export function saveMockState(): void {
  if (!g.__fanoutMock) return;
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, toWire(g.__fanoutMock));
    renameSync(tmp, FILE); // atomic replace: a crash mid-write can't corrupt the file
  } catch (err) {
    console.error("[fanout mock] couldn't save state:", err);
  }
}

export function resetMockState(): void {
  g.__fanoutMock = emptyState();
  saveMockState();
}
