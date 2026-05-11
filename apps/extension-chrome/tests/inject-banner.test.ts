/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { injectBannerIntoCompose } from "../src/content/inject-banner.js";

const SAMPLE_BANNER = '<table data-proofline-banner="true"><tr><td>Verified · ProofLine</td></tr></table>';
const REPLACEMENT_BANNER = '<table data-proofline-banner="true"><tr><td>Bilateral · ProofLine</td></tr></table>';

function makeCompose(): HTMLElement {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "New Message");
  const body = document.createElement("div");
  body.setAttribute("role", "textbox");
  body.setAttribute("aria-label", "Message Body");
  body.setAttribute("contenteditable", "true");
  dialog.appendChild(body);
  document.body.appendChild(dialog);
  return dialog;
}

describe("injectBannerIntoCompose", () => {
  it("prepends the banner to a compose body that has none yet", () => {
    document.body.innerHTML = "";
    const compose = makeCompose();
    const body    = compose.querySelector('[role="textbox"]')!;
    body.appendChild(document.createTextNode("Hi Mark"));

    const result = injectBannerIntoCompose(compose, SAMPLE_BANNER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(false);
    const banner = body.querySelector('[data-proofline-banner="true"]');
    expect(banner).not.toBeNull();
    // Banner is the FIRST child, in front of the user's typed text.
    expect(body.firstElementChild).toBe(banner);
  });

  it("replaces an existing banner when one is already present", () => {
    document.body.innerHTML = "";
    const compose = makeCompose();
    const body    = compose.querySelector('[role="textbox"]')!;
    injectBannerIntoCompose(compose, SAMPLE_BANNER);
    expect(body.querySelector('[data-proofline-banner="true"]')!.textContent).toContain("Verified");

    const result = injectBannerIntoCompose(compose, REPLACEMENT_BANNER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(true);

    // Still exactly one banner; new content wins.
    const banners = body.querySelectorAll('[data-proofline-banner="true"]');
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Bilateral");
  });

  it("inserts above an existing gmail_quote block on a reply compose", () => {
    document.body.innerHTML = "";
    const compose = makeCompose();
    const body    = compose.querySelector('[role="textbox"]')!;
    const quote   = document.createElement("div");
    quote.className = "gmail_quote";
    quote.textContent = "On Tue, Mark wrote: …";
    body.appendChild(quote);

    injectBannerIntoCompose(compose, SAMPLE_BANNER);

    const banner = body.querySelector('[data-proofline-banner="true"]')!;
    // Banner is before the quote in DOM order.
    expect(banner.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("returns NO_BODY when no editable region matches", () => {
    document.body.innerHTML = "";
    const compose = document.createElement("div");
    document.body.appendChild(compose);

    const result = injectBannerIntoCompose(compose, SAMPLE_BANNER);
    expect(result).toEqual({ ok: false, reason: "NO_BODY" });
  });

  it("returns EMPTY_BANNER when the html is whitespace-only", () => {
    document.body.innerHTML = "";
    const compose = makeCompose();
    const result = injectBannerIntoCompose(compose, "   \n   ");
    expect(result).toEqual({ ok: false, reason: "EMPTY_BANNER" });
  });

  it("backfills the data-proofline-banner attribute if the upstream HTML omits it", () => {
    document.body.innerHTML = "";
    const compose = makeCompose();
    const body    = compose.querySelector('[role="textbox"]')!;
    const result = injectBannerIntoCompose(
      compose,
      "<table><tr><td>No marker on me</td></tr></table>",
    );
    expect(result.ok).toBe(true);
    const banner = body.querySelector('[data-proofline-banner="true"]');
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("proofline-banner")).toBe(true);
  });
});
