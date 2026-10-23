// Sending a video from its page (src/components/SendPanel.tsx), for suites that test something else.

/** Chooses clients by name in the Send box's dropdown. */
export async function chooseClients(page, ...names) {
  await page.waitForSelector("[data-testid=client-picker]", { timeout: 20000 });
  // The box always starts with nobody chosen.
  await page.click("[data-testid=client-picker]");
  for (const n of names) await page.click(`[role=listbox] label:has-text("${n}")`);
  if (await page.isVisible("[role=listbox]")) await page.click("[data-testid=send-panel] >> button:has-text('Done')");
}

/** A client's row in the Send box's sections, by their exact name. */
export const sentRow = (page, name) => page.locator("[data-testid=sent-row]").filter({ has: page.locator(`[data-testid=row-name]:text-is("${name}")`) });

/** Chooses these clients and presses the one Send button; returns once each has their row. */
export async function sendTo(page, ...names) {
  await chooseClients(page, ...names);
  await page.click("[data-testid=send]");
  for (const n of names) await sentRow(page, n).waitFor({ timeout: 15000 });
}

/**
 * Sends this video to one client and puts their link to it (with their key) on the clipboard: a first video's link, or
 * a Copy link client's. A client set to Email who's opened a link before is emailed instead, so there's nothing to copy.
 */
export async function sendByLink(page, name) {
  await sendTo(page, name);
  const row = sentRow(page, name);
  const section = await row.getAttribute("data-section");
  if (section === "first") {
    if (await row.locator("[data-testid=first-link-copy]").count()) await row.locator("[data-testid=first-link-copy]").click();
    else {
      await row.locator("[data-testid=first-link-email]").click();
      await row.locator("[data-testid=copy-instead]").click();
    }
  } else if (section === "link") await row.locator("[data-testid=copy-row-link]").click();
  else throw new Error(`${name} was emailed, so there's no link to copy`);
  await row.locator("[data-testid=row-note]:has-text('Copied')").waitFor({ timeout: 15000 });
}
