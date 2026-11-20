/**
 * PFL-188 — the extension's /v1/extension/* routes must answer the CORS
 * preflight for a chrome-extension origin (the policy fetch failed in
 * production with no Access-Control-Allow-Origin). This pins the shared
 * corsMiddleware behavior the routes are mounted behind.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

// corsMiddleware reads no Firestore/secrets, but importing index.ts pulls in
// firebase-admin; stub it so the import is side-effect free.
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn(), getApps: vi.fn(() => [{}]), getApp: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }));

import { corsMiddleware } from "../index.js";

const EXT_ORIGIN = "chrome-extension://jjdabijoladnafmdknekgbhjpbdbiieh";

function app() {
  const a = express();
  a.options("/v1/extension/policy", corsMiddleware);
  a.get("/v1/extension/policy", corsMiddleware, (_req, res) => res.json({ ok: true }));
  return a;
}

describe("CORS preflight for /v1/extension/*", () => {
  it("answers the OPTIONS preflight from a chrome-extension origin", async () => {
    const res = await request(app())
      .options("/v1/extension/policy")
      .set("Origin", EXT_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(EXT_ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toMatch(/GET/);
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/i);
  });

  it("reflects the chrome-extension origin on the GET response too", async () => {
    const res = await request(app()).get("/v1/extension/policy").set("Origin", EXT_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(EXT_ORIGIN);
  });

  it("does not reflect an unknown web origin", async () => {
    const res = await request(app()).get("/v1/extension/policy").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
