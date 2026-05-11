/**
 * @file chrome-mock.ts
 * @module apps/extension-chrome/tests/helpers
 *
 * Lightweight in-memory mock for the chrome.* APIs the extension uses.
 * Strategy:
 *   - chrome.storage.local backed by a plain object map.
 *   - chrome.runtime.{id, onMessage, onMessageExternal} stubbed; tests
 *     can fire listeners via `_fireExternalMessage` / `_fireMessage`.
 *   - chrome.windows.{create, remove, onRemoved} stubbed with a
 *     monotonically increasing windowId so `chrome.windows.create()`
 *     returns predictable handles.
 *   - chrome.tabs.sendMessage stubbed to record calls.
 *
 * Each call to installChromeMock() resets state and returns a handle
 * that lets tests both inspect the doubles and uninstall the global.
 */

import { vi, type Mock } from "vitest";

export interface ChromeMock {
  runtime: {
    id: string;
    lastError?: { message?: string };
    onMessage: { addListener: (fn: AnyListener) => void };
    onMessageExternal: { addListener: (fn: AnyListener) => void };
    onInstalled: { addListener: Mock };
  };
  storage: {
    local: {
      get:    Mock;
      set:    Mock;
      remove: Mock;
      clear:  Mock;
    };
  };
  windows: {
    create:    Mock;
    remove:    Mock;
    onRemoved: { addListener: (fn: (id: number) => void) => void };
  };
  tabs: {
    sendMessage: Mock;
  };
  _store: Record<string, unknown>;
  _onMessageListeners: AnyListener[];
  _onMessageExternalListeners: AnyListener[];
  _onWindowsRemovedListeners: Array<(id: number) => void>;
  _fireExternalMessage: (msg: unknown, sender: { url?: string; origin?: string }) => unknown[];
  _fireMessage: (msg: unknown, sender?: chrome.runtime.MessageSender) => unknown[];
  _fireWindowRemoved: (id: number) => void;
  _nextWindowId: () => number;
  uninstall: () => void;
}

type AnyListener = (...args: unknown[]) => unknown;

export function installChromeMock(): ChromeMock {
  const store: Record<string, unknown> = {};
  const onMessage: AnyListener[]         = [];
  const onMessageExternal: AnyListener[] = [];
  const onWindowsRemoved: Array<(id: number) => void> = [];
  let nextId = 99;

  const mock: ChromeMock = {
    runtime: {
      id: "fakeextensionid0123456789abcdef",
      onMessage:         { addListener: (fn) => onMessage.push(fn) },
      onMessageExternal: { addListener: (fn) => onMessageExternal.push(fn) },
      onInstalled:       { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (k in store) out[k] = store[k];
          }
          return out;
        }),
        set: vi.fn(async (kv: Record<string, unknown>) => {
          Object.assign(store, kv);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(store)) delete store[k];
        }),
      },
    },
    windows: {
      create: vi.fn(async (_opts: chrome.windows.CreateData) => ({
        id: nextId,
      } as chrome.windows.Window)),
      remove: vi.fn(async (_id: number) => {}),
      onRemoved: { addListener: (fn) => onWindowsRemoved.push(fn) },
    },
    tabs: {
      sendMessage: vi.fn(async (_tabId: number, _msg: unknown) => undefined),
    },
    _store: store,
    _onMessageListeners: onMessage,
    _onMessageExternalListeners: onMessageExternal,
    _onWindowsRemovedListeners: onWindowsRemoved,
    _fireExternalMessage(msg, sender) {
      const out: unknown[] = [];
      for (const fn of onMessageExternal) {
        fn(msg, sender, (r: unknown) => out.push(r));
      }
      return out;
    },
    _fireMessage(msg, sender = {} as chrome.runtime.MessageSender) {
      const out: unknown[] = [];
      for (const fn of onMessage) {
        fn(msg, sender, (r: unknown) => out.push(r));
      }
      return out;
    },
    _fireWindowRemoved(id) {
      for (const fn of onWindowsRemoved) fn(id);
    },
    _nextWindowId() {
      return ++nextId;
    },
    uninstall() {
      delete (globalThis as { chrome?: unknown }).chrome;
    },
  };

  (globalThis as { chrome?: unknown }).chrome = mock;
  return mock;
}
