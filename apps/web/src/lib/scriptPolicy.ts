/**
 * The script policy on every page (SEC-9): a second line of defence for the keys that open every video, which live in
 * the browser. Only scripts this site sends with the page run; a script or inline handler slipped into a page by some
 * future mistake is refused by the browser.
 *
 * How: middleware.ts gives each page request a fresh random nonce and this policy. Next.js reads the nonce from the
 * request's Content-Security-Policy header and puts it on its own scripts; app/layout.tsx reads it from NONCE_HEADER
 * for its two small inline scripts. 'strict-dynamic' then lets those scripts load the rest of the site's code (page
 * chunks, the recorder's and transcription's workers are covered by worker-src).
 *
 * Deliberately left out, because nothing here needs them limited and a wrong guess would break a page: default-src,
 * connect-src (presigned uploads and downloads go straight to the storage bucket), img-src, media-src (decrypted
 * video plays from blob: URLs), style-src, font-src, frame-src (the extension's camera bubble is a chrome-extension://
 * frame) and form-action (sign-in with Google and the Stripe pages are reached by redirects after a form).
 */
export const NONCE_HEADER = "x-nonce";

export function scriptPolicy(pathname: string, nonce: string) {
  // 'self' and 'unsafe-inline' only matter to old browsers that don't know 'strict-dynamic' or nonces (newer ones ignore
  // them when a nonce is given). 'wasm-unsafe-eval' is for the speech model's WebAssembly, should a browser hold its
  // worker to the page's policy. In development Next.js and React also need eval.
  const dev = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const script = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'wasm-unsafe-eval'${dev}`;
  // The recorder's camera-in-screen worker is made from a blob: URL (lib/recorder/compose.ts); the speech model's comes
  // from this site (lib/ai/transcribe.ts).
  const worker = "worker-src 'self' blob:";
  // The same three as next.config.ts sends, so the page is no less protected whichever of the two headers a host keeps.
  const frames = pathname === "/settings/branding/preview" ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
  return `${script}; ${worker}; object-src 'none'; base-uri 'self'; ${frames}`;
}

/** A fresh nonce: 16 random bytes, base64. */
export function newNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}
