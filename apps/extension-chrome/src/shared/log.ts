// Guarded console wrapper. Tagged with the surface (content / background /
// popup) so it's easy to grep DevTools output while the extension is loaded.
export type LogSurface = 'content' | 'background' | 'popup';

function tag(surface: LogSurface): string {
  return `[ProofLine ${surface}]`;
}

export function log(surface: LogSurface, ...args: unknown[]): void {
  console.log(tag(surface), ...args);
}

export function warn(surface: LogSurface, ...args: unknown[]): void {
  console.warn(tag(surface), ...args);
}

export function error(surface: LogSurface, ...args: unknown[]): void {
  console.error(tag(surface), ...args);
}
