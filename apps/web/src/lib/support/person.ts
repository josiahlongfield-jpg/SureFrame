/**
 * "Talk to a person" in the help chat (components/SupportChat.tsx, api/support): shared by the
 * browser and the server, so it has no imports.
 */

/** What the button adds to the conversation when the box is empty. */
export const TALK_TO_PERSON = "I'd like to talk to a person, please.";

/** How soon a person replies: the same promise as the /help page and the help guide. */
export const REPLY_WITHIN = "within 2 business days";
