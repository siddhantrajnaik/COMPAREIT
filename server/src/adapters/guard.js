/**
 * Tell "this platform returned nothing" apart from "this platform refused us".
 *
 * Instamart and BigBasket answer requests from datacenter/VPN IPs with an empty
 * body — no markup, no error, nothing. Scraped naively that looks exactly like a
 * search with zero results, which sends you hunting for a parser bug that
 * doesn't exist. This checks for the actual signature of a refusal (a page that
 * never rendered) and raises a distinct error, so the UI can say "blocked"
 * instead of quietly lying with a zero.
 *
 * Note this only catches a *refusal*. Being served a real page with an empty
 * catalogue — what these sites do to any IP outside India — looks perfectly
 * healthy here and is caught later by the quality gate in engine/quality.js.
 */
class BlockedError extends Error {
  constructor(platform, detail) {
    super(`${platform} returned an empty page — the platform is refusing this connection${detail ? ` (${detail})` : ''}`);
    this.name = 'BlockedError';
    this.blocked = true;
  }
}

export async function assertRendered(page, platform) {
  const probe = await page.evaluate(() => ({
    text: (document.body?.innerText || '').trim().length,
    nodes: document.body?.querySelectorAll('*').length || 0,
    title: document.title || '',
  }));

  // Text, not node count, is the real tell. A blocked platform can still ship
  // an app shell — Instamart renders ~450 empty nodes and zero characters — so
  // counting nodes alone would wave that through as "0 results found".
  if (probe.text < 40) {
    throw new BlockedError(platform, `page rendered ${probe.nodes} nodes but no text`);
  }

  // A rendered challenge/captcha wall is also a block, just a chattier one.
  if (/just a moment|attention required|access denied|are you a robot/i.test(probe.title)) {
    throw new BlockedError(platform, probe.title.slice(0, 60));
  }
}
