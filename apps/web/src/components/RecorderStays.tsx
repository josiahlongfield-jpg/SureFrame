"use client";

import { useState, type ReactNode } from "react";

/**
 * The Record page shows the recorder, or the "used all free videos" card once none are left. A recording under way
 * holds the last place itself, so anything that makes the server draw the page again mid-recording (the header's
 * own Record link, "I've saved it" on the recovery key) would swap the recorder for the card and end the take.
 * So a recorder that was showing when the page opened stays until the page is left. The server still refuses to
 * start another recording, with its own message.
 */
export default function RecorderStays({ limited, card, children }: { limited: boolean; card: ReactNode; children: ReactNode }) {
  const [opened] = useState(!limited);
  return <>{limited && !opened ? card : children}</>;
}
