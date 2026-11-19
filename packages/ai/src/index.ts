/**
 * @file index.ts
 * @module packages/ai
 *
 * Public surface of @proofline/ai (PFL-028): advisory memo screening for
 * social-engineering patterns on wire instructions.
 */

export * from "./types.js";
export {
  makeGeminiScreener,
  parseScreeningOutput,
  ScreeningError,
  GEMINI_DEFAULT_MODEL,
  GEMINI_API_REVISION,
} from "./providers/gemini.js";
export type { GeminiScreenerConfig } from "./providers/gemini.js";
export { makeHeuristicScreener, makeNoopScreener } from "./providers/heuristic.js";
export { screenSafely } from "./screen.js";
