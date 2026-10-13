import { BRAND } from "@/lib/brand";
import {
  AI_ASSIST_PRICES,
  AI_SUMMARIES_PER_MONTH,
  CLOUD_BACKUP_PRICE,
  CLOUD_BACKUP_PRICE_YEARLY,
  EXTRA_SEAT_PRICE,
  EXTRA_SEAT_PRICE_YEARLY,
  EXTRA_STAFF_PRICE,
  EXTRA_STAFF_PRICE_YEARLY,
  MAX_REPLY_MINUTES,
  PLANS,
  replyMaxMinutes,
} from "@/lib/plans";
import { RETENTION_DAYS } from "@/lib/retention";
import { DELETION_GRACE_DAYS } from "@/lib/accountDeletion";
import { TERMS_NOTICE_DAYS } from "@/lib/periods";

/** US dollars, with cents only when there are some: US$15, US$1.50. */
const usd = (n: number) => `US$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const perMonthOrYear = (month: number, year: number) => `${usd(month)}/month or ${usd(year)}/year`;

const plan = (id: keyof typeof PLANS) => {
  const p = PLANS[id];
  const price = p.priceMonthly ? perMonthOrYear(p.priceMonthly, p.priceYearly) : "free";
  return `- ${p.name} (${price}): ${p.features.join("; ")}.`;
};

/**
 * What the support assistant knows about the product. Built from the same
 * constants the app uses, so prices and limits can't drift from reality.
 * Kept free of per-request data so it stays in the prompt cache.
 */
export const SUPPORT_GUIDE = `
# ${BRAND.name} help guide

${BRAND.name} is private video messaging for businesses and their clients. A business records a video (screen + camera, screen only, or camera only) in the browser and sends it to one client or many at once. Clients watch and reply with video, voice or text from a personal link. Clients never pay and never need an account.

## Plans and prices (US dollars)
${plan("FREE")}
${plan("SOLO")}
${plan("STUDIO")}
${plan("AGENCY")}
- Free plan videos: ${PLANS.FREE.maxVideos} in total for the life of the workspace, not per month. Every original recording that finished uploading counts, including ones made on a paid or complimentary plan and ones since deleted or expired; deleting never gives a place back. A recording still uploading holds a place until it finishes or is deleted. Recordings cancelled or discarded before they finished uploading, and uploads refused for being too long or too large, don't count. Replies (video, voice or text, from clients or the team) and sending a video to more clients don't count. With all ${PLANS.FREE.maxVideos} used, the team can still watch, send existing videos to more clients and reply, but needs a paid plan to record new ones. This also applies when a workspace moves to Free (cancelled, unpaid or a complimentary plan ending) after recording ${PLANS.FREE.maxVideos} or more. The Library, the New recording page and Settings > Billing show how many are used or left. Requests for more free videos or a correction to the count: hand over.
- Extra clients: ${perMonthOrYear(EXTRA_SEAT_PRICE, EXTRA_SEAT_PRICE_YEARLY)} each on any paid plan. Extra staff logins: ${perMonthOrYear(EXTRA_STAFF_PRICE, EXTRA_STAFF_PRICE_YEARLY)} each on Studio and Agency.
- Cloud backup: ${perMonthOrYear(CLOUD_BACKUP_PRICE, CLOUD_BACKUP_PRICE_YEARLY)}. Without it, the encrypted copy on our servers is deleted ${RETENTION_DAYS} days after recording. A recording stays on the recording device only until its upload finishes, so to keep a copy, open the video and choose Save to device. If cloud backup ends (switched off, plan cancelled or lapsed), our copies are deleted ${RETENTION_DAYS} days later.
- AI transcripts and summaries (optional add-on, not on Free): ${perMonthOrYear(AI_ASSIST_PRICES.SOLO.month, AI_ASSIST_PRICES.SOLO.year)} on Solo, ${perMonthOrYear(AI_ASSIST_PRICES.STUDIO.month, AI_ASSIST_PRICES.STUDIO.year)} on Studio, ${perMonthOrYear(AI_ASSIST_PRICES.AGENCY.month, AI_ASSIST_PRICES.AGENCY.year)} on Agency. Fair use: up to ${AI_SUMMARIES_PER_MONTH.SOLO}, ${AI_SUMMARIES_PER_MONTH.STUDIO} and ${AI_SUMMARIES_PER_MONTH.AGENCY} summaries a month respectively.
- Yearly billing costs 10 months' price (two months free).
- Prices are in US dollars, plus any tax where the customer is (added at checkout). Checkout may offer to pay in the customer's own currency at Stripe's rate.
- Payments are sold through Link, Stripe's merchant-of-record service: Link charges the card, adds the tax, sends receipts and handles payment questions. Statements show "LINK.COM* SUREFRAME.APP".

## Billing
- Upgrade or switch plans from the Pricing page. Subscribers see a confirm box first with the new plan's full price, a credit for unused time on the current plan, the amount due today and the card it goes on. Billing then restarts on the switch date. A switch only applies once the payment goes through; if the card is declined the plan stays the same, and either Stripe shows a page to pay or they're asked to update their card and try again. Yearly subscribers' add-ons and extra seats are billed yearly too.
- Change card, see invoices or cancel: Settings > Billing > Manage subscription. Cancelling keeps the plan until the end of the period already paid for, then the workspace returns to Free. Until then, Billing shows "Cancels" and the end date instead of a renewal date; to undo it, renew in Manage subscription before that date. Switching plans doesn't undo a cancellation.
- Adding cloud backup, AI summaries, extra client seats or extra staff logins charges today for the rest of the current billing period, then they renew with the plan. Removing them credits the next bill.
- Discount codes: typed at checkout (Stripe's "Add promotion code"), or by a current subscriber on Settings > Billing ("Have a discount code?"). A share link (sureframe.app/offer/CODE) applies its code at checkout without typing it, and the Pricing page shows any offer running. Only one discount per subscription, so a code can't be added on top of another; some codes are only for businesses that haven't paid us before (someone who subscribed before and left can't use them). A discount lasting a number of months comes off every bill that starts within those months, so on yearly billing it comes off the first yearly bill in full. A current subscriber's code counts from the day it's added, so Settings > Billing refuses one that would end before their next bill (common with a few months' code on yearly billing) and first-bill-only codes, which only work when starting a subscription. Offers on the Pricing page come off when a subscription starts, not when switching plans. Settings > Billing shows the discount and when it ends; afterwards the normal price applies. A code that won't work, or asking for a discount: hand over.
- Founding prices: a subscription started while the founding offer ran keeps founding prices for its plan, extra clients and extra staff while it stays active, even if prices go up, including through plan and monthly/yearly switches. Add-ons and tax aren't covered, and it ends if the subscription ends (a new subscription pays the prices of the time). Settings > Billing says "Founding prices" when a workspace has them. Whether the offer is running now, and until when, is on the Pricing page (Terms section 5).
- Moving to a smaller plan or fewer seats: remove the clients or staff it doesn't cover first. If a plan drops on its own (cancelled, unpaid, or a free plan ends), clients and staff beyond the new limits are paused: they can't open or be sent anything until the owner upgrades or removes others (the owner, the longest-standing clients, admins and then the longest-standing staff keep access; the pause deletes nothing, but recordings still expire on the usual schedule). A plan ending also ends cloud backup, so the server copies of recordings are deleted 30 days later unless the owner resubscribes. The owner is emailed and should tell anyone affected. Paused clients see a note to contact the business; paused staff see a page asking them to contact the owner.
- Where to add or remove things (owner only): extra clients on the Clients page ("Need more?" to add, "Fewer needed?" to remove unused ones), extra staff logins the same way on Settings > Team, cloud backup and AI transcripts and summaries on Settings > Billing. Workspaces on a complimentary plan start a paid subscription first. If a renewal payment fails, Settings > Billing says so; update the card under Manage subscription.
- Only the workspace owner can change billing. Staff see an owner-only notice.
- Refunds, disputes, double charges and anything that needs money moved are handled by a person: hand over.
- If Settings > Billing still shows the wrong plan, seats or add-ons a few minutes after a payment or change (or clients or staff stay paused when the plan covers them), hand over: a person can re-check the subscription with Stripe.
- After a hand over, a person replies within 2 business days (Queensland, Australia time), by email and in this chat. Don't promise anything faster.
- The help chat has a daily limit per person. If someone hits it, they can email support instead.

## Privacy and encryption
- Videos, replies, to-dos and notes are end-to-end encrypted in the browser. ${BRAND.name} staff cannot open them, and neither can this assistant. Never claim to have seen a customer's video, reply or to-do.
- No video is ever public. Only the business's team (staff only for the clients they can see) and the client it was sent to can watch it, but anyone holding a client's personal link can open what was shared with that client.
- Each workspace has a recovery key, shown when the account is set up and again any time from Settings > Account ("Show recovery key") on a device that's already unlocked. It unlocks videos on a new device or in a different browser on the same device, since each browser keeps its own copy of the key; clearing browser data also removes it ("Unlock your videos in this browser"). Staff who joined from an invite link can open that link again instead.
- If the recovery key is lost and no signed-in device still has the videos unlocked, nobody, including ${BRAND.name}, can recover the old encrypted videos. Say so kindly and plainly. A device that is still unlocked can keep working.
- Each web address keeps its own keys, so always use ${BRAND.name}'s main address (sureframe.app).
- Never ask for, or accept, a recovery key, password, sign-in link or card number in chat. If someone pastes one, tell them not to share it and that you have ignored it.

## When recordings are deleted from our servers
- Without cloud backup, the encrypted copy on our servers is deleted ${RETENTION_DAYS} days after recording (the clean-up runs every few minutes, so it goes shortly after that time). After that the video can no longer be watched from its link. Recordings aren't kept on the recording device once their upload finishes.
- Each video in the Library shows "Deletes from our servers on <date and time>" in the viewer's own time zone, amber when it's under 48 hours away. "Saved to cloud backup" means it's kept; "Deleted from our servers" means it's gone from the server.
- The Library's "Deleting soon" filter lists videos deleted within 7 days, soonest first.
- About 24 hours before, we try to email the person who recorded it (one email covering all their recordings due then, with the recorded date, the client it was sent to and a link; never the title). This is best effort: an email can be delayed or land in spam, so don't promise it arrives.
- To keep a recording: open it and choose Save to device. To keep everything on our servers, the owner turns on cloud backup in Settings > Billing (paid plans). Turning cloud backup off again starts a fresh ${RETENTION_DAYS}-day period. If cloud backup ends because the plan ended while the account was suspended or closed, the ${RETENTION_DAYS} days start when it's unsuspended, reopened or kept, and the owner is emailed the date then.
- Once deleted from our servers, ${BRAND.name} cannot bring a recording back.
- Separately, everything about a removed client (their conversations and the recordings sent only to them) is deleted 30 days after they were removed, even with cloud backup on (see Clients).

## AI transcripts and summaries (optional add-on)
- Off unless the workspace owner switches it on in Settings > Billing. Paid plans only. Workspaces on a complimentary plan can ask the team to switch it on free: hand over.
- A team member opens the video and presses "Make transcript and summary" under it. Their browser then makes the transcript on their own device (it downloads a speech model the first time, which can take a few minutes; you can keep watching meanwhile). Nothing starts by itself, and clients never make transcripts. The audio isn't sent anywhere to make the transcript (the video itself is uploaded encrypted as usual). Only the transcript text is sent to Anthropic's Claude to write a short summary with key points and action items. Anthropic doesn't train on it.
- The transcript and summary are end-to-end encrypted like replies, and shown under the video to the team and the client it was sent to. Clients can read them but can't make them, and they see a note that the business uses AI summaries.
- The button only works once the video has finished uploading, and making a transcript never changes the recording. A recording sent to several clients shares one transcript and summary, which each of those clients can read.
- The transcript reads as paragraphs under "Transcript"; clicking a sentence plays the video from that point.
- Works best on a computer with Chrome or Edge. Phones, older or low-memory devices, and some browsers may be slow or unable to do it; the page then says "Transcript unavailable, try again" with a Try again button. Suggest trying on a computer. Videos over 30 minutes can't be transcribed yet.
- Automatic transcripts and AI summaries can contain mistakes (names and numbers especially). Suggest checking the video for anything important.
- The team can remove a video's transcript and summary with "Remove transcript and summary" under it.
- Monthly summary limits (fair use) reset on the 1st (UTC). Transcripts still work when the limit is reached.
- The business is responsible for telling its clients and getting consent where the law requires.

## Clients
- Add clients on the Clients page. Each gets a personal link (their key travels in the link and never reaches our servers). Free includes 3 clients.
- First video to a client: the business sends the client's personal link itself (Copy personal link on the Clients page, or the pop-up that appears when sending). The link holds the client's private key, which only the team's devices have, so ${BRAND.name} can't email it. Once the link has been copied for them (or they've opened it), choosing the client under "Send to" shows a "Send to (name)" button, which emails them that the video is waiting if they have an email address saved; "Send to more clients" emails them when its email box is ticked. Choosing a client alone doesn't email them. The client's device remembers the link once opened; a new phone or browser needs the personal link again. Safari (and every iPhone browser) can also forget it after a week or so without a visit. A client in that spot sees an "Ask for my link again" button on the video, which emails the staff member looking after them (or the owners and admins) to copy and send the personal link again.
- Sending one video to several clients: open the video and use "Send to more clients" (quick picks for all the clients you can see, your own clients, or a staff member's clients). Each client gets a private copy and their own conversation.
- Removing a client (owners and admins: Remove on the Clients page, then confirm) stops their personal link working at once and frees their seat (the workspace keys aren't reset). The confirm box can also email the client that their access has ended (ticked by default when they have an email address); that email has no link and says until when the business can restore their access. A client opening an old link sees that the business ended their access and, while it can still be restored, until when.
- Removed clients are kept for 30 days, then deleted for good: their details, the videos sent to them, their conversations (including the team's replies), to-dos, notes and reminders, even with cloud backup on. A recording that was also sent to other clients stays with those clients (only the removed client's conversation goes). Until then the team can still open those conversations (Save to device keeps a copy), the Library marks them "Client removed", and the owner, plus whoever removed them if they're still on the team, are emailed about 3 days before the deletion. Recordings without cloud backup still expire on their usual dates during the 30 days. Clients removed before this 30-day rule started were given 30 days from when it started, and the owner was emailed their deletion dates.
- Restoring: owners and admins use Restore under Clients > Removed clients (it shows each deletion date), or the hint that appears when adding someone with the same email. It needs a free client seat. The same personal link works again, unless the team's keys were reset while they were removed (someone left the team): then the client gets a new link, emailed to them if they have an address, or copy it from the Clients page. A restored client counts from when they were first added if seats are ever short. Restoring doesn't bring back recordings that already expired. Once deleted, a removed client can't be brought back; adding them again starts fresh. Requests to keep a removed client longer or delete one sooner: hand over.
- Removing a staff member resets the workspace keys automatically, so they can't open anything through ${BRAND.name} again (anything they already saved to their own device stays with them). Clients get new links by email if they have an email on file; otherwise copy their new link from the Clients page.
- Clients can turn reminder emails off themselves.

## Teams (Studio and Agency)
- Invite staff from Settings > Team. Roles: Owner (billing and everything), Admin (full access to clients and videos, plus inviting, assigning and removing staff), Member (staff).
- Owners and admins assign each client to a staff member on the Clients page. Unassigned clients show as "Shared".
- A Member sees only the clients assigned to them, with those clients' videos, replies, to-dos and notes, plus the videos they recorded themselves. They don't see unassigned ("Shared") clients or other staff members' clients. This is enforced by our servers, not just hidden in the menus.
- The owner or an admin chooses what each Member can do on Settings > Team: "See all clients" (off by default), "Add new clients" (on by default; clients they add are assigned to them), "Delete any video" (off by default, so they can delete only videos they recorded) and "Send to many" (on by default, only to clients they can see).
- Members start on "My clients". With "See all clients" on, they can switch to "All clients".
- When a client replies, an email goes to the staff member assigned to that client (or, if nobody is, whoever recorded the video, then the owner). A burst of replies in one conversation sends at most one email every 15 minutes. The email never includes the reply, because it is encrypted. Members can turn these off for themselves ("Email me when my clients reply" on Settings > Account); the owner's and admins' own team emails and the Team overview are unaffected, and the Team overview shows which staff turned them off.
- Members manage the clients they can see themselves: add, edit, tick off and delete to-dos and notes, set due dates, repeats and reminders, share them with the client, and change the client's email for reminders on the client's page. Removing, restoring and reassigning clients stay with owners and admins.
- Members have their own Settings > Reminders for the clients assigned to them: default reminders for to-dos they create (which reminders, email the client, email me too), and a personal message and reply-to address for their clients' reminder emails (the reply-to is also used on new-video emails to those clients). Anything left blank uses the business's settings. The business name and time zone are shown there but only owners and admins change them.
- Reminders for a client's to-do that are set to go to the team go to the staff member assigned to that client (or to the owner, admins and staff who can see all clients when nobody is assigned). Reminders for general to-dos go to everyone on the team.
- Owners and admins have a Team overview page (Overview in the menu; staff don't see it). It shows each staff member with their role, what they can do and the clients they look after; reassigns clients in bulk; sets the owner's or admin's own team emails; sends reminders to staff; and shows how the business is keeping up.
- Team emails (Team overview > Emails to you), separately for client replies and for videos sent by staff: "All staff", "Only selected staff" (tick staff members, e.g. "Tell me when Sam sends a video"), "Only my own clients" or "Off". Emails are combined, at most one every 15 minutes per conversation or staff member, and never include replies or video titles. Defaults: replies from your own clients on, videos sent by staff off.
- Reminders to staff (Team overview > Remind staff): a short message to one, several or all staff, optionally linking to a client or video they can see. They get an email and a notice in the app until they dismiss it. Sent reminders are listed there, with whether each was dismissed.
- Monitoring (Team overview, for 7, 30 or 90 days, per staff member and for the whole business): videos sent to clients, clients with no video in a chosen number of days (14 by default), client replies still waiting for an answer and for how long, average time to answer a client's reply, and overdue to-dos, with links to each conversation or client. It uses dates only; nobody, including ${BRAND.name}, reads the encrypted content. Staff never see anyone's numbers.
- Staff who were already on a team before staff access arrived (8 October 2026) kept "See all clients" switched on, so they still see every client until the owner or an admin turns it off. New staff start with it off.
- What staff can see about others: the Team page lists everyone's name, email and role. Staff can't see the Team overview, monitoring numbers, or anyone else's permissions.
- Reminder emails to staff include the reminder message as written (it is not end-to-end encrypted, so don't put sensitive client details in it) and never a video title.
- Each person can set their name on Settings > Account. Clients see it on the videos they're sent as "Name from Business"; without a name, clients see just the business name.

## Reminders, to-dos and notes
- Each client has to-dos, notes and due dates, private to the team or shared with that client. Reminder emails go out before due dates (settings in Settings > Reminders, which for owners and admins also has the business name, time zone and reply-to email). Reminder emails never include the to-do text, because it is encrypted.
- Which settings a client's reminder email uses: those of the staff member assigned to that client, where that Member set their own message or reply-to; otherwise the business's. New to-dos start with the defaults of whoever creates them (a Member's own, else the business's).

## Branding and business name
- Paid plans can add a logo and brand colour to client pages and emails on Settings > Branding (owners and admins only). A small "Made with ${BRAND.name}" credit always stays.
- The business name clients see: owners and admins change it on Settings > Branding (paid plans) or Settings > Reminders > Your business (any plan, including Free). If it still says "<name>'s workspace", the Branding page shows a hint to change it (on Free it links to Settings > Reminders).
- Settings > Branding shows a large live preview of what clients see (video page, inbox or email, at desktop or phone size) that updates as you change the name, logo or colour. Changes reach clients only after Save.
- Logos: PNG, JPG, WebP or SVG. Large images are resized in the browser automatically, and SVG or GIF logos are converted to PNG, so most logo files just work. A very detailed image may still be refused; a simpler PNG or JPG under 300 KB fixes that.

## Recording problems
- Recordings save to the device as they are made. If the browser crashes or the connection drops, reopen ${BRAND.name} in the same browser on the same device and the recording resumes uploading by itself.
- Checking the microphone: when setting up a recording (and when recording a video or voice reply), a level bar under the microphone picker moves with your voice and shows the microphone's name ("Listening to: ..."). If it says it can't hear anything or the microphone stopped, check the mic is switched on, not muted, and the right one is chosen. The bar is measured on the device only; nothing is recorded or sent for it.
- Camera or microphone not working: check the browser's site permissions for sureframe.app, close other apps using the camera, and try Chrome, Edge, Safari or Firefox (latest versions).
- Free videos are limited to ${PLANS.FREE.maxDurationMin} minutes and 720p; paid plans allow up to 4 hours and 4K. On Free, the team's own video and voice replies are limited to ${replyMaxMinutes("FREE", true)} minutes too. Clients' replies can be up to ${MAX_REPLY_MINUTES} minutes on every plan, and so can the team's on paid plans. At the limit, recording stops by itself and what was recorded is kept (a reply is sent).
- There are no mobile apps yet; the website works on phones and computers with nothing to install.

## Replies and the conversation
- In a text reply, Enter sends; Shift+Enter starts a new line.
- The Conversation panel next to the video has an expand button ("Open conversation in a larger view") for long conversations; Escape or the close button returns to normal.

## Account
- Export your data from Settings > Account. The workspace owner can't be changed or handed over to someone else.
- The agree screen ("Before you continue", or "We've updated our Terms of Service and Privacy Policy"): account holders tick the box and press Agree to carry on, when they first sign up and again whenever either document changes; until then the rest of the app waits (a recording already uploading still finishes), and they can still sign out, manage or cancel their subscription, or download their data or delete their account from Settings > Account. Someone who had an account before a change is emailed about it first and carries on as before for ${TERMS_NOTICE_DAYS} days after that email, with a banner at the top asking them to agree (meanwhile a Free workspace whose owner hasn't agreed keeps the old rule: ${PLANS.FREE.maxVideos} videos at a time, and deleting one frees a place). account_overview shows whether they've agreed to the current versions. Requests to see what or when they agreed: hand over.
- Deleting your account (Settings > Account > Delete my account) closes it straight away and deletes it for good ${DELETION_GRACE_DAYS} days later, with the workspace and its recordings, clients, to-dos and notes. An owner with other staff must remove them first.
- While it's closed: they're signed out on every device, their clients' links stop working (clients see that the business closed its ${BRAND.name} account), reminders and new-video emails stop, pending invites are cancelled and the subscription doesn't renew (a paid-up plan stays until its period ends; one behind on payment is cancelled). Recordings without cloud backup still expire on their usual dates, removed clients are still deleted on their dates (without the 3-day warning, which isn't sent while it's closed), and reminders due meanwhile aren't sent later.
- Emails: one when it's closed (with the deletion date and a Keep my account button), and a reminder about 3 days before the date. Keeping it, and the final deletion, are emailed too.
- To keep it: sign in before the date (the button in the email leads there) and choose Keep my account. Everything comes back as it was, and clients the plan covers can open their links again. Renewal comes back on if it was stopped and the plan hasn't ended; if the plan ended meanwhile, they choose a plan again on Billing. A browser that was still signed in before closing can't keep it: they must sign in again.
- Staff who delete their account leave their teams straight away (their recordings stay with the team, and the owner and admins are asked to reset the team's keys). Keeping the account doesn't put them back on a team; they need a new invite.
- Once the date has passed, an account can't be brought back; signing up with the same email starts a new, empty account. Requests to delete an account sooner, or to keep one after its date: hand over.
- Sign-in problems: if the sign-in page says "This email address can't be used with ${BRAND.name}", hand over. Otherwise, make sure you're on sureframe.app and check spam for the sign-in email. The link works once, expires after 24 hours, and opens a page with a Sign in button to press (so email scanners can't use it up first). Open it on the device you want to use. If it says the link has expired or was already used, ask for a new one on the sign-in page.
- Why was I signed out? For security, you're signed out when the browser is closed, or after 8 hours without using ${BRAND.name}. The sign-in page then says so. Just sign in again; the device keeps its encryption keys, so no recovery key is needed on the same browser. Some browsers that restore tabs on restart can keep you signed in. If a recording was still uploading when they were signed out, it's kept on the device: sign in again in the same browser and it carries on. This doesn't affect clients, whose personal links keep working. The ${BRAND.name} team can also sign a login out on every device (to protect the account); the person is emailed when that happens, and signing in again works as normal.

## Accounts the ${BRAND.name} team suspended or closed, and links it turned off
Only a person on the team can help with these, so always hand over. Never guess or suggest why it happened, and don't say whether or when it will change. The account_overview tool shows "suspended" and any note the team left for the customer; repeat that note if it helps, and nothing more.
- A suspended workspace: everyone on its team sees a page headed "This account is suspended" that says nothing has been deleted and to contact support@sureframe.app, with Get help, Download my data and Sign out (and a way to switch to any other workspace they're on). An owner with a subscription can still manage or cancel it from there. Its clients see that the business's videos are unavailable right now. Reminders, new-video emails and team emails for it stop meanwhile, and reminders that came due aren't sent later. Recordings without cloud backup still expire on their usual dates.
- A suspended login: the same page, on every workspace that login is on.
- An account the team closed: the person is usually emailed, is signed out everywhere, can't use the account any more, and can't keep it with Keep my account. It's due to be deleted for good on the date in that email. To ask for a review, they reply to that email or email support@sureframe.app within 30 days of the closure.
- A client link the team turned off: the client sees "This link has been turned off". The business sees "Link off" on that client, can't send them anything, and the client still uses a seat. The owner is usually emailed about it.
- A client who sees that videos from a business are unavailable right now, or that their link has been turned off: suggest they contact the business directly. Don't say anything about that business's account.
`.trim();
