import { BRAND } from "@/lib/brand";
import { MAX_REPLY_MINUTES } from "@/lib/plans";
import { RETENTION_DAYS } from "@/lib/retention";
import { HELD_REPLY_DAYS } from "@/lib/heldReplies";
import { CLIENT_KEEP_DAYS, CLIENT_QUESTION_KEEP_DAYS, DELETION_GRACE_DAYS } from "@/lib/periods";
import { REACTIONS } from "@/lib/reactions";
import { BROWSER_FORGETS } from "@/lib/support/browser";

/**
 * What the help chat on client pages knows: only what a business's client sees and can do, written from the
 * client pages themselves (WatchView, ReplyComposer, the inbox, the "can't open" cards, the emails page) and the
 * Privacy Policy's client section. Kept apart from the business guide (knowledge.ts) so nothing about plans,
 * billing or the team's side reaches clients. Built from the app's own constants, like knowledge.ts, and free of
 * per-request data so it stays in the prompt cache.
 */
export const CLIENT_GUIDE = `
# ${BRAND.name} client help guide

A business (a coach, tutor, consultant and so on) uses ${BRAND.name} to send its clients private videos. The person you're helping is one of that business's clients. They opened a personal link the business gave them. Clients don't need an account, never sign in and never pay. The business decides what to send them and holds their details; ${BRAND.name} runs the pages for the business.

## The personal link and this device
- Each client has their own personal link from the business (sent by the business itself, for example by text, message or email). The link to the first video a business sends them works the same way. It's long: its end holds the client's private key, which never reaches ${BRAND.name}'s servers, so the whole link must be used. That key is what unlocks their videos, replies, to-dos and notes.
- Opening the personal link once on a phone, computer or browser makes that device remember it, so later links (including the ones in new-video emails) open there. Each browser keeps its own copy: a new phone, a different browser, a private window, or clearing the browser's data means opening the personal link again there.
- Safari and every browser on iPhone and iPad can forget it after a week or so without a visit.
- Asked for the personal link again on the same phone or computer? The device only forgets it if the browser's saved data is cleared. Opening the personal link again in their usual browser brings everything back, and nothing is lost. Common reasons:
  1. The email or message app opened the link in its own built-in browser instead of their usual one: open the link in the usual browser, or set the app to open links there (for example, in the Gmail app, Settings > Default apps).
  2. The browser forgets the site's data when it closes, or a private or incognito window is used (it always forgets when closed), or a cleaning or privacy app wipes site data. ${BROWSER_FORGETS}
- A device that recognises the client but doesn't have their key shows "This video is private" (in the inbox, "Your videos are private") with an "Ask for my link again" button. That button emails the business (the person looking after them, or the owners and admins) to ask them to send the personal link again; the business sends it themselves. Then open it on this device. Nothing is lost.
- An address ending in /v/... (the address bar on a video) doesn't unlock anything on its own: only the personal link does.
- Keep the personal link to yourself: anyone holding it can open what the business shared with that client.
- ${BRAND.name} can't send a personal link or a new one: only the business's team can. If the link was lost or doesn't work, ask the business for it again.
- "This link doesn't look right" means part of it is missing or mistyped: open it again from the original message, using the whole link, or ask the business for it.
- "This link is incomplete or mistyped" means the end of the link (the part that unlocks their videos) was changed or cut off, for example when a long link is copied or forwarded. Nothing is lost: open it again from the original message. On a device that already had their key, the videos still open, with a note that the link just opened was incomplete or mistyped and the device kept the key it already had.

## Their videos ("Your videos", the inbox)
- The inbox lists every video from each business on this device, in folders by when it arrived (one per day for the last week, then weeks, then months; the newest folder starts open), with a still from each video, "New" on ones not yet watched, "You replied" where they've replied and "Unsent reply" where a recorded reply is waiting to be sent or deleted. Under each business's name it says who the videos are for ("For <their name>"). "Tiles" or "List" at the top changes the layout, and this browser remembers the choice. "All my videos" at the top of a video page goes to it, and "Back to video" there returns to the video they came from.
- Each video page says who it's for ("For <their name>") and shows the video, who sent it ("Name from Business", or just the business's name; "Former team member · Business" with a line saying the person has since left the business and replies still reach it) and when, any message the business added above the video, and the conversation.
- A text reply written while the video was playing starts with the moment it was written, such as "at 0:06": tapping it plays the video from there.
- In the conversation, a video reply (theirs or the business's) shows as a small still with its length. Tap it to play it large over the page; close it with Close, Escape or by tapping outside it.
- Save to device downloads the video. Some videos save as .webm files, which some iPhones and iPads can't play; a computer can. "How this works" under the video says so, under "Can I keep a copy?".
- Clients of businesses on ${BRAND.name}'s free plan see a short ${BRAND.name} intro the first time they open a video from that business on a device. It can be skipped after a few seconds and starts the video. It's shown once per device for each business.
- Some businesses use AI summaries: the page then says so, and clients may see a transcript and summary under the video. Clients can read them but can't make them. Their replies aren't included. Summaries can contain mistakes.

## Replying
- Replies can be text, video or voice: choose Text, Video or Voice in the reply box. On phones, tap "Reply to <business>" under the video to open the conversation (it says "Reply to <name> at <business>" when the team member who sent the video is the one looking after them); on a computer it's beside the video, with a button to open it larger.
- Text: type and press Send reply. On a computer, Enter sends and Shift+Enter starts a new line. On a phone or tablet, Enter starts a new line and the Send reply button sends.
- Video and voice: press Record video reply or Record voice reply, then Stop recording. It plays back before anything is sent, with Send, Re-record and Discard. Nothing sends by itself. Discard deletes the recording and nothing is sent. Replies can be up to ${MAX_REPLY_MINUTES} minutes; recording stops by itself at the limit and what was recorded is kept for review.
- The browser asks to use the camera or microphone. If it doesn't work: check the browser's site permissions for this site, make sure the microphone isn't muted and is the right one (a level bar shows it hearing them), close other apps using the camera, or try another up-to-date browser.
- If the connection drops while a reply uploads, it's kept on the device and carries on uploading when it's back online.
- A video or voice reply goes up to the servers every few seconds while it's recorded (encrypted), so an interrupted one (the browser closed, say) isn't lost. It's never sent by itself. Within about 90 seconds of when it stopped, it's back when they open the video or their inbox again, on any phone or browser where they've opened their personal link: a box asks "Send or delete your unfinished reply?" with Send it and Delete it. Nobody else has seen it. An unsent video or voice reply is deleted ${HELD_REPLY_DAYS} days after it was recorded, and can't be recovered after that; the box shows the date.
- After sending they see "Sent". The business is usually emailed that they replied (unless the business turned those emails off). The email never includes the reply, because it's encrypted.
- Deleting a reply: tap Delete under any of their own replies. It's removed for both sides straight away, recording included. They can't delete the business's messages or videos.
- Reactions: pick one of ${REACTIONS.join(" ")} under the video. Only one at a time: picking another replaces it, and tapping it again takes it back. The business sees the one they picked, and the line under them says which it is ("Your reaction: …").
- Who sees replies: only the client and the business's team. If the business sent the same recording to other people, each conversation is separate, and no other client sees theirs.

## To-dos and notes
- The business can share to-dos and notes with a client. They appear in the inbox ("Your to-dos & notes") and under each video from that business, and a client can tick off a shared to-do. Only the business adds or changes them.
- Reminder emails may come before a to-do is due. They never include what the to-do says, because it's encrypted.

## Emails from the business
- Reminder and new-video emails come in the business's name. Replying to one reaches the business, unless the email says "Please don't reply to this email"; then contact the business directly.
- A business can add its own contact details (an email address, a phone number or both). When it has, they show on the client's pages as "Contact <business>: …" (on each video page, under the business's name in their inbox, and on pages saying a video can't be opened), and in the emails it sends them. When it hasn't, nothing shows; never make contact details up.
- To stop them: use the link at the bottom of any of them ("Stop emails from <business>" or "Turn them off"), then press Stop emails on the page that opens. That turns off that business's reminders and new-video emails; the videos still open from the personal link. The inbox also shows whether they're on or off, with Turn off or Turn on. Turning them back on is one tap (Turn on, or "Turn them back on" on the emails page).
- New-video emails only reach a client once they've opened their personal link on a device. ${BRAND.name} can't email the personal link itself.
- If emails aren't arriving, check spam or junk, and that emails from the business are on. Whether the business has the right email address is something to ask the business.

## Remove from this device
- "Remove from this device" next to a business's name in the inbox makes this browser forget that business's personal link and the key that unlocks its videos. It asks to confirm first. Nothing is deleted: opening the personal link again brings everything back. Useful on a shared or borrowed device.

## When videos and replies leave the servers
- Some businesses keep videos until they delete them. Otherwise a video's encrypted copy on ${BRAND.name}'s servers is deleted ${RETENTION_DAYS} days after it was recorded, and the video page shows the date ("This video will be deleted from ${BRAND.name} on ..."). Save it to the device before then to keep a copy.
- A video or voice reply's encrypted copy leaves the servers ${RETENTION_DAYS} days after it finished uploading (usually moments after it was recorded), unless the business keeps videos until it deletes them. One that was recorded but never sent is deleted ${HELD_REPLY_DAYS} days after it was recorded. Text replies stay until they're deleted or the conversation is deleted.
- Once a video's server copy is deleted, its link says "This link has expired" and it can't be watched or brought back by ${BRAND.name}. Ask the business to send it again if it's still needed. A deleted video or voice reply shows "This reply has been deleted from ${BRAND.name}."
- If the business deletes a video, its conversation goes with it.

## When a link stops working
The page says which of these applies. Explain only what the page says, and never guess why it happened or whether or when it will change.
- "Your access has ended": the business removed them as a client. Their details and conversations with that business are deleted for good ${CLIENT_KEEP_DAYS} days later unless the business restores their access first. If it's a mistake, contact the business.
- "Your access is paused": the business changed its ${BRAND.name} plan. Nothing is deleted by the pause, but videos are only kept for a limited time, so contact the business soon.
- "This link no longer opens your videos": the business closed its ${BRAND.name} account. Their details and conversations with it are deleted ${DELETION_GRACE_DAYS} days later unless the business keeps its account. Contact the business directly.
- "Your link was replaced": the business replaced their personal link to keep their videos secure, so the old one no longer opens them. Nothing has been deleted. If the page says the business has emailed them their new link, open that link on this device. Otherwise press "Ask for my link again", or ask the business for the new link, then open it on this device.
- "Unavailable right now" or "This link has been turned off": only the business can help with this; suggest contacting the business. Say nothing about the business's account.

## Privacy, for clients
- Videos, any message the business adds to a video, replies (text, voice and video), to-dos and notes are end-to-end encrypted: ${BRAND.name} can't watch or read them, and neither can this chat.
- ${BRAND.name} can see a client's name and email address (as the business entered them), the titles of videos sent to them, when they first opened their personal link, how many times they opened each video, and their emoji reactions.
- The business can see their name and email address, when they first opened their personal link, how many times they've opened each video, their replies and reactions, and whether they turned off its emails.
- Clients under 18 may use a client link only with a parent's or guardian's permission, which the business is responsible for getting.
- The business holds the client's details and decides what to send, so questions about their information go to the business first. The Privacy Policy (the Privacy link at the bottom of every page) explains more, including how to contact ${BRAND.name} about personal information.
- This help chat has limits, which the panel states: clients of a business on the free plan can ask up to 5 questions a day; others up to 10 every 10 minutes and 40 a day. When one is reached, the panel says when they can ask again, and Ask stays off until then.
- When this chat can't answer (or hits a problem), its reply ends with a "Reply to <business>" button that opens the reply box on the video, so they can ask the business itself. Where there's no reply box (for example a video this device can't open), it says to contact the business instead. This chat can't pass on a message. To reach the business, they reply on a video, or reply to one of the business's emails unless it says not to. The "can't help" answer names the business's contact details when it has added them (otherwise its reply-to email, when it has set one), and the page shows them too.
- This help chat: questions are answered by an AI assistant (Anthropic's Claude), which sees only what's typed here, which business's page it is and which browser and device they're using (as the browser reports it), never videos, replies, to-dos or notes. The text of each question is kept for ${CLIENT_QUESTION_KEEP_DAYS} days, with the business's name but not who asked, and may be read by ${BRAND.name} to improve this help (for example, to see what the chat couldn't answer and fix problems), so don't type anything private here. Nobody from ${BRAND.name} answers this chat or replies to it: for a person, they contact the business.
`;
