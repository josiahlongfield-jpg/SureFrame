// Sending a video from its page (src/components/SendPanel.tsx), for suites that test something else.

/** Chooses clients by name in the Send box's dropdown. */
export async function chooseClients(page, ...names) {
  await page.waitForSelector("[data-testid=client-picker]", { timeout: 20000 });
  await page.click("[data-testid=client-picker]");
  for (const n of names) await page.click(`[role=listbox] label:has-text("${n}")`);
  if (await page.isVisible("[role=listbox]")) await page.click("[data-testid=send-panel] >> button:has-text('Done')");
}

/** Sends this video to one client with Copy link, leaving their personal link on the clipboard. */
export async function sendByLink(page, name) {
  await chooseClients(page, name);
  await page.click("[data-testid=send-link]");
  await page.waitForSelector("text=/link is copied/", { timeout: 15000 });
}
