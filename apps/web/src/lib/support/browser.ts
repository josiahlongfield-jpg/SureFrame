/**
 * Which browser and device someone is using, read from what their browser sends with each request, so the help
 * chats can give the steps for that browser only. A best guess: browsers can disguise themselves (Brave reports
 * itself as Chrome, except in its client hints) and an iPad can report itself as a Mac.
 */
export function browserFrom(headers: Headers): string | null {
  const ua = headers.get("user-agent") ?? "";
  const hints = headers.get("sec-ch-ua") ?? "";
  if (!ua) return null;
  const device = /iPhone|iPod/.test(ua)
    ? "an iPhone"
    : /iPad/.test(ua)
      ? "an iPad"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "an Android phone"
          : "an Android tablet"
        : /Windows/.test(ua)
          ? "a Windows computer"
          : /CrOS/.test(ua)
            ? "a Chromebook"
            : /Macintosh|Mac OS X/.test(ua)
              ? "a Mac"
              : /Linux/.test(ua)
                ? "a Linux computer"
                : null;
  const apple = device === "an iPhone" || device === "an iPad";
  const browser = /FBAN|FBAV|FB_IAB/.test(ua)
    ? "Facebook's built-in browser"
    : /Instagram/.test(ua)
      ? "Instagram's built-in browser"
      : /GSA\//.test(ua)
        ? "the Google app's built-in browser"
        : /"Brave"/.test(hints)
          ? "Brave"
          : /EdgiOS|EdgA|Edg\//.test(ua)
            ? "Microsoft Edge"
            : /SamsungBrowser/.test(ua)
              ? "Samsung Internet"
              : /OPR\/|OPiOS|OPT\//.test(ua)
                ? "Opera"
                : /DuckDuckGo|Ddg\//.test(ua)
                  ? "DuckDuckGo"
                  : /FxiOS|Firefox\//.test(ua)
                    ? "Firefox"
                    : /"Google Chrome"/.test(hints)
                      ? "Chrome"
                      : /CriOS/.test(ua) ||
                          (/Chrome\//.test(ua) && !/; wv\)/.test(ua))
                        ? "Chrome (or Brave, which reports itself as Chrome)"
                        : /; wv\)/.test(ua) || (apple && !/Safari\//.test(ua))
                          ? "an app's built-in browser (not their usual browser)"
                          : /Safari\//.test(ua)
                            ? "Safari"
                            : null;
  if (!browser && !device) return null;
  return [browser ?? "an unknown browser", device && `on ${device}`]
    .filter(Boolean)
    .join(" ");
}

/** The note the help chats add for the AI, or nothing when the browser can't be told. */
export function browserNote(browser: string | null | undefined): string {
  return browser
    ? `Going by what their browser reports (which can be wrong), they're using ${browser} right now. When steps depend on the browser or device, give the steps for that one only; if they say they use something else, go by what they say.`
    : "Their browser couldn't be told from the request. When steps depend on the browser or device, ask which browser and device they use before giving them.";
}

/**
 * Where each browser's "forget this site" settings live, for both help guides. Menu names come from current
 * versions and can differ a little between versions, so the AI says so when it gives them.
 */
export const BROWSER_FORGETS = `Give only the steps for the browser and device they're using (see the note about their browser; ask if it isn't known), never the whole list, and mention that menu names can differ a little between versions:
  - Chrome on a computer: Settings > Privacy and security > Site settings > Additional content settings > On-device site data (in older versions, Third-party cookies or Cookies and other site data). Turn off "Delete data sites have saved to your device when you close all windows", or add sureframe.app under "Allowed to save data on your device".
  - Chrome on Android, iPhone or iPad: it doesn't clear on close by itself, so the usual causes are Incognito tabs, clearing browsing data by hand, or the link opening in another app or browser.
  - Brave on a computer: Settings > Privacy and security > Delete browsing data, "On exit" tab: untick "Cookies and other site data" and "Cached images and files" (unticking these has fixed it for people). Also in Brave: Settings > Privacy and security > Site and Shields Settings > On-device site data, the same "Delete data sites have saved..." switch as Chrome; and on sureframe.app, open Brave Shields (the lion icon) and turn off "Forget me when I close this site".
  - Brave on a phone or tablet: in Settings, look under Brave Shields & privacy (or Privacy) for clearing data when Brave closes and turn it off; and in Brave Shields on sureframe.app, turn off "Forget me when I close this site" if it's there.
  - Microsoft Edge on a computer: Settings > Privacy, search, and services > Delete browsing data > "Choose what to delete every time you close the browser": turn off "Cookies and other site data" and "Cached images and files". Also Settings > Cookies and site permissions > Manage and delete cookies and site data: make sure sureframe.app isn't on the "Clear on exit" list.
  - Microsoft Edge on a phone or tablet: Settings > Privacy and security: turn off clearing browsing data on exit if it's on.
  - Firefox on a computer: Settings > Privacy & Security > Cookies and Site Data: untick "Delete cookies and site data when Firefox is closed", or add https://sureframe.app as Allow under Manage Exceptions. Under History, "Never remember history" or "Clear history when Firefox closes" (when its settings include cookies or site data) forgets it too; choose "Remember history" or untick those.
  - Firefox on Android: Settings > Delete browsing data on quit: turn it off. Firefox on iPhone or iPad: private tabs forget everything; otherwise the iPhone and iPad weekly limit below applies.
  - Safari on a Mac: Safari > Settings > Privacy: untick "Block all cookies". Private windows forget everything when closed. Safari can also remove a site's saved data after about a week without a visit.
  - Safari on iPhone or iPad: Settings > Apps > Safari (Settings > Safari on older versions): turn off "Block All Cookies" (under Advanced on some versions). Private Browsing tabs forget everything. Safari, and every browser on iPhone and iPad, can remove a site's saved data after about a week without a visit, so a visit at least weekly avoids it.
  - Samsung Internet: Secret mode forgets everything; in Settings > Personal browsing data (or Privacy), turn off deleting browsing data on exit if it's on.
  - Opera: like Chrome, under Settings > Privacy & security (Site settings, Cookies and site data or On-device site data): turn off clearing cookies and site data on quit, or allow sureframe.app.
  - DuckDuckGo: the Fire button and "Automatically clear data" clear everything; Fireproof sureframe.app (from the menu while on the site) or turn automatic clearing off in Settings > Data Clearing.
  - An app's built-in browser (Gmail, Outlook, Facebook, Instagram, the Google app and others): it keeps its own separate data, often clears it, and isn't their usual browser, so open the link in their usual browser instead (most of these apps have "Open in browser" in their menu).`;
