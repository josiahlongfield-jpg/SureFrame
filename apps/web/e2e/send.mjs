// Sending a video from its page (src/components/SendPanel.tsx), for suites that test something else.

/** Chooses clients by name in the Send box's dropdown. */
export async function chooseClients(page, ...names) {
  await page.waitForSelector("[data-testid=client-picker]", { timeout: 20000 });
  // Straight after Stop the client the last video went to is chosen for you (D12): start from exactly these names.
  const suggested = await page.getAttribute("[data-testid=client-picker]", "data-preselected");
  await page.click("[data-testid=client-picker]");
  const multi = (await page.locator("[role=listbox] input[type=checkbox]").count()) > 0;
  if (suggested && multi && !names.includes(suggested)) await page.click(`[role=listbox] label:has-text("${suggested}")`);
  for (const n of names) if (n !== suggested) await page.click(`[role=listbox] label:has-text("${n}")`);
  if (await page.isVisible("[role=listbox]")) await page.click("[data-testid=send-panel] >> button:has-text('Done')");
}

/** Sends this video to one client with Copy link, leaving their link to it (with their key) on the clipboard. */
export async function sendByLink(page, name) {
  await chooseClients(page, name);
  // A new client's first video is sent from the first-video box instead (only they are chosen, so it's theirs).
  const first = page.locator(`[data-testid=first-link-row] [data-testid=first-link-copy]`);
  if (await first.count()) await first.click();
  else await page.click("[data-testid=send-link]");
  await page.waitForSelector("text=/link is copied/", { timeout: 15000 });
}
