import type { ReactNode } from "react";
import { PLANS } from "@/lib/plans";
import { Face, Icon } from "./icons";

/*
 * The eight frames in the home page's app window. Each one is drawn from the real
 * app page it stands for, with the same labels, controls and wording, and only
 * generic sample data (Client A, Team member 1, "Your business name").
 */

export type Frame = { key: string; tab: ReactNode; icon: ReactNode; title: string; detail: string; body: ReactNode };

const Cb = ({ on }: { on?: boolean }) => <span className={`f-cb${on ? " y" : ""}`} />;

function Record() {
  return (
    <div className="f-cols">
      <div className="f-screen">
        <div className="f-pill"><i />Recording · 1:24</div>
        <div className="msg">{Icon.monitor}<span>Recording your screen. Your camera is in the floating bubble.</span></div>
        <div className="f-cam"><Face /></div>
      </div>
      <div className="f-side f-box">
        <p className="f-h">Recording</p>
        <div className="f-row" style={{ flexWrap: "nowrap" }}>
          <span className="f-btn sec wide">Pause</span>
          <span className="f-btn red wide">Stop</span>
        </div>
        <span className="f-link" style={{ justifySelf: "start" }}>Discard and start over</span>
        <div className="f-hr" />
        <p className="f-ok" style={{ fontSize: "0.78125rem" }}>Uploaded: 12.3 MB <span className="f-mut">(+0.8 MB on device)</span></p>
        {/* The real page says "Limit on your plan: 4 hours."; here it's a paid plan's, so say which (V10). */}
        <p className="f-dim">Limit on your plan: {PLANS.SOLO.maxDurationMin / 60} hours per video on paid plans, {PLANS.FREE.maxDurationMin} minutes on Free.</p>
      </div>
    </div>
  );
}

function Send() {
  const list: [string, boolean][] = [["Client B", true], ["Client C", true], ["Client D", false], ["Client E", true]];
  return (
    <div className="f-stack">
      <div className="f-row" style={{ justifyContent: "space-between" }}>
        <div>
          <p className="f-h2">Weekly check-in</p>
          <p className="f-dim">Team member 1 · Oct 15 · 3 views</p>
        </div>
        <div className="f-row f-hide-sm"><span className="f-btn sec">Save to device</span><span className="f-btn sec">Delete</span></div>
      </div>
      <div className="f-box">
        <p style={{ fontWeight: 500 }}>Send to more clients</p>
        <div className="f-pick">
          <span className="f-select">3 clients chosen</span>
          <div className="f-drop">
            <div className="f-row"><span className="f-chip">All clients</span><span className="f-chip">My clients</span><span className="f-chip" style={{ border: 0 }}>Clear</span></div>
            <div className="f-cards" style={{ gap: "0.4375rem 0.875rem" }}>
              {list.map(([n, on]) => <span key={n} className="f-check"><Cb on={on} />{n}</span>)}
            </div>
          </div>
        </div>
        <div className="f-row"><span className="f-btn pri">Send by email</span><span className="f-btn sec">Get their links</span></div>
        <p className="f-dim f-hide-md">Send by email and we email each client who has opened their personal link before. The first time, copy their link and send it from your own app, texts or messages.</p>
        {/* No room for the sent list in the phone-sized window: it would run out of the box. */}
        <div className="f-hr f-hide-sm" />
        <p className="f-hide-sm" style={{ fontWeight: 500 }}>Sent to</p>
        <div className="f-sent f-hide-sm">
          <span>Client A <span className="f-ok">Emailed</span></span>
          <span className="f-row"><span className="f-btn sec sm">Email again</span><span className="f-btn sec sm">Copy link</span></span>
        </div>
      </div>
    </div>
  );
}

function Replies() {
  return (
    <div className="f-cols">
      <div className="f-side f-stack">
        <div className="f-screen" style={{ aspectRatio: "16 / 10" }}>
          <div className="f-play">{Icon.play}</div>
          <div className="f-cam"><Face /></div>
        </div>
        <p className="f-h2">Weekly check-in</p>
        <div className="f-react"><span>👍</span><span>❤️</span><span>🎉</span><span>👀</span></div>
      </div>
      <div className="f-box" style={{ gap: "0.625rem" }}>
        <div>
          <p className="f-h2">Conversation</p>
          <p className="f-dim f-hide-narrow">Reply with a video, a voice note or a message. End-to-end encrypted.</p>
        </div>
        <div className="f-bub them">
          <small>Client A · Oct 15, 3:04 PM</small>
          <div><span className="f-moment">1:05</span>Thanks, that part makes sense now!</div>
        </div>
        <div className="f-bub them">
          <small>Client A · Oct 15, 3:06 PM</small>
          <div className="f-audio"><i>{Icon.play}</i><b /><span>0:42</span></div>
        </div>
        <div className="f-bub f-hide-narrow">
          <small>Team member 1 · Oct 15, 4:10 PM</small>
          <div>Great. I&apos;ll send the next steps tomorrow.</div>
        </div>
        <div className="f-seg" style={{ justifySelf: "start" }}><span className="on">Text</span><span>Video</span><span>Voice</span></div>
        <div className="f-row" style={{ flexWrap: "nowrap" }}>
          <span className="f-field ph" style={{ flex: 1 }}>Write a reply…</span>
          <span className="f-btn sec">Send reply</span>
        </div>
      </div>
    </div>
  );
}

function Todos() {
  // The To-dos/Reminders page: its To-dos tab, then halfway through the frame's turn its Reminder settings tab.
  const tabs = (on: 0 | 1) => (
    <div className="f-pgtabs"><span className={on === 0 ? "on" : ""}>To-dos</span><span className={on === 1 ? "on" : ""}>Reminder settings</span></div>
  );
  return (
    <div className="ff-flip">
      <div className="v1 f-stack" style={{ gap: "0.5rem" }}>
        {tabs(0)}
        <div className="f-cols">
          <div className="f-stack" style={{ gap: "0.5rem" }}>
            <div className="f-due"><b>2 to-dos are overdue or due within a day</b><span><u>Client A</u> (1) · Your list below (1)</span></div>
            <p className="f-h">To-dos &amp; notes</p>
            <div className="f-todo">
              <Cb /><span>Prepare next week&apos;s update</span>
              <div className="meta"><span>Due Tue, Oct 21, 9:00 AM</span><span>{Icon.bell}Day before at 8:00 AM · The team</span></div>
            </div>
            <div className="f-todo f-hide-sm">
              <Cb /><span>Send the monthly summary</span>
              <div className="meta"><span>Due Fri, Oct 31, 9:00 AM</span><span>{Icon.repeat}Every month on the 31st</span></div>
            </div>
            <p className="f-h" style={{ marginTop: "0.25rem" }}>Done (2) ▸</p>
          </div>
          <div className="f-side f-stack">
            <div className="f-box">
              <span className="f-field ph">Add a to-do…</span>
              <p className="f-h">Remind</p>
              <div className="f-row" style={{ gap: "0.375rem" }}><span className="f-chip on">Day before at 8:00 AM</span><span className="f-chip">At due time</span></div>
              <span className="f-check"><Cb on />Email the team</span>
            </div>
          </div>
        </div>
      </div>
      <div className="v2 f-stack" style={{ gap: "0.5rem" }} aria-hidden="true">
        {tabs(1)}
        <div className="f-cols">
          <div className="f-box" style={{ gap: "0.5rem" }}>
            <b style={{ fontWeight: 600 }}>Default reminders for new to-dos</b>
            <div className="f-row" style={{ gap: "0.375rem" }}><span className="f-chip on">Day before at 8:00 AM</span><span className="f-chip on">At due time</span><span className="f-chip">+ Add</span></div>
            <span className="f-check"><Cb on />Email the client for to-dos shared with them</span>
            <span className="f-check f-hide-sm"><Cb on />Email whoever looks after the client too</span>
            <b style={{ fontWeight: 600 }}>Personal message</b>
            <span className="f-field">Reply to this email if you need to reschedule.</span>
            <span className="f-btn pri f-hide-sm" style={{ justifySelf: "start" }}>Save changes</span>
          </div>
          <div className="f-side f-stack">
            <p className="f-h">What your client sees</p>
            <div className="f-mail">
              <span>From: Your business name via SureFrame</span>
              <b>Reminder from Your business name: a to-do is due tomorrow at 9am</b>
              <span className="f-hide-sm">Reply to this email if you need to reschedule.</span>
              <i>Open your list</i>
              <span>For privacy, the details are only shown in the app.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AiSummary() {
  return (
    <div className="f-box f-ai" style={{ gap: "0.5rem" }}>
      <div className="f-row" style={{ justifyContent: "space-between" }}>
        <div className="f-row"><span className="f-aipill">AI</span><b style={{ fontWeight: 600 }}>AI summary and transcript</b><span className="f-dim">Summary ready</span></div>
        <span className="f-mut f-hide-sm" style={{ fontSize: "0.75rem" }}>Hide</span>
      </div>
      <p className="f-mut">A walkthrough of this week&apos;s progress, the two questions still open, and the plan for next week.</p>
      <b style={{ fontWeight: 500 }}>Key points</b>
      <ul>
        <li>Everything is on track for this month</li>
        <li className="f-hide-sm">Two questions to follow up on</li>
        <li className="f-hide-sm">The new plan starts next Monday</li>
      </ul>
      <b style={{ fontWeight: 500 }}>Action items</b>
      <ul>
        <li>Send the new plan tonight</li>
        <li className="f-hide-sm">Book the next session</li>
      </ul>
      <p className="f-dim f-hide-sm">Written by AI from an automatic transcript. It can contain mistakes, so check anything important against the video.</p>
      <p className="f-dim f-only-sm">Written by AI. Check anything important against the video.</p>
      <div className="f-hr f-hide-sm" />
      <p className="f-hide-sm" style={{ fontWeight: 500 }}>Transcript ▾</p>
      <p className="f-tx f-hide-sm">Hi, here&apos;s this week&apos;s update. Everything is on track so far, so let&apos;s look at the two open questions. I&apos;ll send the new plan tonight, and we can go through it together next session.</p>
      <p className="f-dim f-hide-sm">Made on the sender&apos;s device. Only the transcript text is sent to AI to write the summary.</p>
    </div>
  );
}

function Backup({ days }: { days: number }) {
  const vids: [string, string, string][] = [["Weekly check-in", "4:12", "Oct 15 · 3 views"], ["Onboarding walkthrough", "7:48", "Oct 13 · 5 views"], ["Project update", "2:36", "Oct 9 · 2 views"], ["Session recap", "11:05", "Oct 6 · 4 views"]];
  return (
    <div className="f-cols">
      <div className="f-stack">
        <div><p className="f-h2">Your videos</p><p className="f-dim">12 videos</p></div>
        <div className="f-cards f-vids">
          {vids.map(([t, d, m], i) => (
            <div key={t} className={`f-card${i > 1 ? " f-hide-sm" : ""}`}>
              <div className={`f-thumb still s${i}`}><span className="slide" /><span className="cam"><Face /></span><em>{d}</em></div>
              <b>{t}</b>
              <span className="f-dim">{m}</span>
              <span className="f-ok" style={{ fontSize: "0.71875rem" }}>Saved to cloud backup</span>
            </div>
          ))}
        </div>
      </div>
      <div className="f-side f-stack">
        <div className="f-box">
          <div className="f-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <b style={{ fontWeight: 600 }}>Cloud backup</b>
            <span style={{ width: "1.875rem", height: "1.0625rem", borderRadius: 999, background: "var(--color-primary)", position: "relative", flex: "none" }}>
              <span style={{ position: "absolute", right: "0.125rem", top: "0.125rem", width: "0.8125rem", height: "0.8125rem", borderRadius: "50%", background: "#fff" }} />
            </span>
          </div>
          <p className="f-mut" style={{ fontSize: "0.75rem" }}>We keep an encrypted copy so your clients can watch it, and delete it after {days} days. Cloud backup keeps our encrypted copies until you delete them. We still can&apos;t open them.</p>
          <p className="f-dim">Optional: US$5 a month</p>
        </div>
        <p className="f-dim">Settings › Billing</p>
      </div>
    </div>
  );
}

function Branding() {
  const sw = ["#3b55e6", "#0f766e", "#1f7a5c", "#b91c1c", "#c2410c", "#7c3aed", "#be185d", "#0f172a"];
  return (
    <div className="f-cols">
      <div className="f-client">
        <header><i>Your logo here</i><b>Your business name</b><span>via SureFrame</span></header>
        <div className="body">
          <div className="f-screen"><div className="f-play">{Icon.play}</div><div className="f-cam"><Face /></div></div>
          <b style={{ fontWeight: 600, fontSize: "0.78125rem" }}>Weekly check-in</b>
          <span className="sm">Team member 1 from Your business name · Oct 15</span>
          <span className="bub f-hide-sm">Thanks, that makes sense!</span>
        </div>
        <footer>Made with SureFrame · Privacy · Terms</footer>
      </div>
      <div className="f-side f-box" style={{ gap: "0.5rem" }}>
        <p className="f-h">Business name</p>
        <span className="f-field">Your business name</span>
        <p className="f-h">Logo</p>
        <div className="f-row"><span className="f-logo">Your logo here</span></div>
        <div className="f-row"><span className="f-btn sec">Replace logo</span><span className="f-link">Remove</span></div>
        <p className="f-h">Accent colour</p>
        <div className="f-sw">{sw.map((c) => <i key={c} className={c === "#0f766e" ? "on" : ""} style={{ background: c }} />)}</div>
        <span className="f-btn pri" style={{ justifySelf: "start" }}>Save branding</span>
      </div>
    </div>
  );
}

function Team() {
  const rows: [string, number, number, number, string, number][] = [
    ["Team member 1 (you)", 14, 0, 0, "2h", 0],
    ["Team member 2", 9, 1, 2, "5h", 1],
    ["Team member 3", 6, 0, 1, "3h", 0],
  ];
  return (
    <div className="f-stack">
      <div className="f-row" style={{ justifyContent: "space-between" }}>
        <p className="f-h2">How the team is doing</p>
        <div className="f-seg"><span className="on">7 days</span><span>30 days</span><span>90 days</span></div>
      </div>
      <table className="f-table">
        <thead>
          <tr><th>Staff</th><th>Videos sent</th><th className="wide">Clients with no video in 7d</th><th>Unanswered replies</th><th className="wide">Avg reply time</th><th>Overdue to-dos</th></tr>
        </thead>
        <tbody>
          {rows.map(([n, v, s, u, a, o]) => (
            <tr key={n}><td>{n}</td><td>{v}</td><td className="wide">{s}</td><td className={u ? "hot" : ""}>{u}</td><td className="wide">{a}</td><td className={o ? "hot" : ""}>{o}</td></tr>
          ))}
          <tr className="all"><td>All</td><td>29</td><td className="wide">1</td><td>3</td><td className="wide">3h</td><td>1</td></tr>
        </tbody>
      </table>
      <p className="f-h f-hide-sm" style={{ marginTop: "0.25rem" }}>Staff and clients</p>
      <div className="f-cards f-hide-sm">
        <div className="f-person"><div className="f-row"><b style={{ fontWeight: 500 }}>Team member 2</b><span className="f-chip">Member</span></div><span className="f-dim">Looks after: Client C, Client D</span></div>
        <div className="f-person"><div className="f-row"><b style={{ fontWeight: 500 }}>Team member 3</b><span className="f-chip">Admin</span></div><span className="f-dim">Looks after: Client E</span></div>
      </div>
    </div>
  );
}

export function frames(retentionDays: number): Frame[] {
  return [
    { key: "record", tab: "Record", icon: Icon.record, title: "New recording", detail: "Screen + Camera", body: <Record /> },
    { key: "send", tab: "Send", icon: Icon.send, title: "Weekly check-in", detail: "Send to many", body: <Send /> },
    { key: "replies", tab: "Replies", icon: Icon.reply, title: "Weekly check-in", detail: "Conversation", body: <Replies /> },
    { key: "todos", tab: <span className="ff-wrap">To-dos/<wbr />Reminders</span>, icon: Icon.todo, title: "To-dos/Reminders", detail: "Your team", body: <Todos /> },
    { key: "ai", tab: "AI summary", icon: Icon.ai, title: "Weekly check-in", detail: "AI add-on", body: <AiSummary /> },
    { key: "backup", tab: "Backup", icon: Icon.cloud, title: "Library", detail: "Cloud backup add-on", body: <Backup days={retentionDays} /> },
    { key: "branding", tab: "Branding", icon: Icon.brand, title: "Branding", detail: "Paid plans", body: <Branding /> },
    { key: "team", tab: "Team", icon: Icon.team, title: "Team", detail: "Studio & Agency", body: <Team /> },
  ];
}
