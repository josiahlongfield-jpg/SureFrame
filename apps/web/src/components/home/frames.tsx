import type { ReactNode } from "react";
import { Face, Icon } from "./icons";

/*
 * The eight frames in the home page's app window. Each one is drawn from the real
 * app page it stands for, with the same labels, controls and wording, and only
 * generic sample data (Client A, Team member 1, "Your business name").
 */

export type Frame = { key: string; tab: string; icon: ReactNode; title: string; detail: string; body: ReactNode };

const Cb = ({ on }: { on?: boolean }) => <span className={`f-cb${on ? " y" : ""}`} />;

function Record() {
  return (
    <div className="f-cols">
      <div className="f-screen">
        <div className="f-pill"><i />Recording · 1:24</div>
        <div className="msg">{Icon.monitor}<span>Recording your screen.</span></div>
        <div className="f-cam"><Face /></div>
      </div>
      <div className="f-side f-box">
        <p className="f-h">Recording</p>
        <div className="f-row" style={{ flexWrap: "nowrap" }}>
          <span className="f-btn sec wide">Pause</span>
          <span className="f-btn red wide">Stop</span>
        </div>
        <span className="f-btn sec">Pop out camera bubble</span>
        <span className="f-link" style={{ justifySelf: "start" }}>Discard and start over</span>
        <div className="f-hr" />
        <p className="f-ok" style={{ fontSize: 12.5 }}>Uploaded: 12.3 MB <span className="f-mut">(+0.8 MB on device)</span></p>
        <p className="f-dim">Limit on your plan: 4 hours.</p>
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
        <div className="f-row f-hide-sm"><span className="f-btn sec">Copy link</span><span className="f-btn sec">Save to device</span></div>
      </div>
      <div className="f-box">
        <div className="f-row"><b style={{ fontWeight: 500 }}>Send to</b><span className="f-select">Client A</span></div>
        <p className="f-dim f-hide-sm">Only your team and Client A can watch this. We&apos;ve emailed Client A to say it&apos;s waiting.</p>
        <div className="f-hr" />
        <p style={{ fontWeight: 500 }}>Send to more clients</p>
        <div className="f-row"><span className="f-chip">All clients</span><span className="f-chip">My clients</span><span className="f-chip" style={{ border: 0 }}>Clear</span></div>
        <div className="f-cards" style={{ gap: "7px 14px" }}>
          {list.map(([n, on]) => <span key={n} className="f-check"><Cb on={on} />{n}</span>)}
        </div>
        <span className="f-check"><Cb on />Email clients who have an address on file</span>
        <div className="f-row"><span className="f-btn pri">Send to 3 clients</span><span className="f-mut" style={{ fontSize: 12.5 }}>Done</span></div>
        <p className="f-dim">Each client gets a private copy. They can reply, but never see each other&apos;s replies.</p>
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
      <div className="f-box" style={{ gap: 10 }}>
        <div>
          <p className="f-h2">Conversation</p>
          <p className="f-dim">Reply with a video, a voice note or a message. End-to-end encrypted.</p>
        </div>
        <div className="f-bub them">
          <small>Client A · Oct 15, 3:04 PM</small>
          <div><span className="f-moment">1:05</span>Thanks, that part makes sense now!</div>
        </div>
        <div className="f-bub them">
          <small>Client A · Oct 15, 3:06 PM</small>
          <div className="f-audio"><i>{Icon.play}</i><b /><span>0:42</span></div>
        </div>
        <div className="f-bub">
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
  return (
    <div className="f-cols">
      <div className="f-stack" style={{ gap: 8 }}>
        <p className="f-h">To do</p>
        <div className="f-todo">
          <Cb /><span>Book your next session</span>
          <div className="meta"><span>Due Fri, Oct 17, 9:00 AM</span><span>{Icon.bell}1 day before · Client A and you</span><span className="f-chip">Shared with Client A</span></div>
        </div>
        <div className="f-todo">
          <Cb /><span>Review the new plan</span>
          <div className="meta"><span>Due Mon, Oct 20, 9:00 AM</span><span>{Icon.repeat}Every week on Monday</span><span className="f-chip">Shared with Client A</span></div>
        </div>
        <div className="f-todo f-hide-sm">
          <Cb /><span>Prepare next week&apos;s update</span>
          <div className="meta"><span>Due Tue, Oct 21, 9:00 AM</span><span className="f-chip">Private to your team</span></div>
        </div>
        <p className="f-h" style={{ marginTop: 4 }}>Done (2) ▸</p>
      </div>
      <div className="f-side f-stack">
        <div className="f-box">
          <p className="f-h">Remind</p>
          <div className="f-row" style={{ gap: 6 }}><span className="f-chip on">1 day before</span><span className="f-chip">On the day (8am)</span></div>
          <span className="f-check"><Cb on />Email Client A</span>
          <span className="f-check"><Cb on />Email me</span>
        </div>
        <div className="f-mail">
          <b>Reminder from Your business name: a to-do is due tomorrow at 9am</b>
          <i>Open your list</i>
          <span>For privacy, the details are only shown in the app.</span>
        </div>
      </div>
    </div>
  );
}

function AiSummary() {
  return (
    <div className="f-box f-ai" style={{ gap: 8 }}>
      <div className="f-row" style={{ justifyContent: "space-between" }}>
        <div className="f-row"><span className="f-aipill">AI</span><b style={{ fontWeight: 600 }}>AI summary and transcript</b><span className="f-dim">Summary ready</span></div>
        <span className="f-mut f-hide-sm" style={{ fontSize: 12 }}>Hide</span>
      </div>
      <p className="f-mut">A walkthrough of this week&apos;s progress, the two questions still open, and the plan for next week.</p>
      <b style={{ fontWeight: 500 }}>Key points</b>
      <ul>
        <li>Everything is on track for this month</li>
        <li>Two questions to follow up on</li>
        <li className="f-hide-sm">The new plan starts next Monday</li>
      </ul>
      <b style={{ fontWeight: 500 }}>Action items</b>
      <ul>
        <li>Send the new plan tonight</li>
        <li>Book the next session</li>
      </ul>
      <p className="f-dim">Written by AI from an automatic transcript. It can contain mistakes, so check anything important against the video.</p>
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
        <div className="f-cards">
          {vids.map(([t, d, m], i) => (
            <div key={t} className={`f-card${i > 1 ? " f-hide-sm" : ""}`}>
              <div className="f-thumb">{Icon.lock}<em>{d}</em></div>
              <b>{t}</b>
              <span className="f-dim">{m}</span>
              <span className="f-ok" style={{ fontSize: 11.5 }}>Saved to cloud backup</span>
            </div>
          ))}
        </div>
      </div>
      <div className="f-side f-stack">
        <div className="f-box">
          <div className="f-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <b style={{ fontWeight: 600 }}>Cloud backup</b>
            <span style={{ width: 30, height: 17, borderRadius: 999, background: "var(--color-primary)", position: "relative", flex: "none" }}>
              <span style={{ position: "absolute", right: 2, top: 2, width: 13, height: 13, borderRadius: "50%", background: "#fff" }} />
            </span>
          </div>
          <p className="f-mut" style={{ fontSize: 12 }}>We keep an encrypted copy so your clients can watch it, and delete it after {days} days. Cloud backup keeps our encrypted copies until you delete them. We still can&apos;t open them.</p>
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
          <b style={{ fontWeight: 600, fontSize: 12.5 }}>Weekly check-in</b>
          <span className="sm">Team member 1 from Your business name · Oct 15</span>
          <span className="bub">Thanks, that makes sense!</span>
        </div>
        <footer>Made with SureFrame · Privacy · Terms</footer>
      </div>
      <div className="f-side f-box" style={{ gap: 8 }}>
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
      <p className="f-h f-hide-sm" style={{ marginTop: 4 }}>Staff and clients</p>
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
    { key: "todos", tab: "To-dos", icon: Icon.todo, title: "Client A", detail: "To-dos & notes", body: <Todos /> },
    { key: "ai", tab: "AI summary", icon: Icon.ai, title: "Weekly check-in", detail: "AI add-on", body: <AiSummary /> },
    { key: "backup", tab: "Backup", icon: Icon.cloud, title: "Library", detail: "Cloud backup add-on", body: <Backup days={retentionDays} /> },
    { key: "branding", tab: "Branding", icon: Icon.brand, title: "Branding", detail: "Paid plans", body: <Branding /> },
    { key: "team", tab: "Team", icon: Icon.team, title: "Team overview", detail: "Studio & Agency", body: <Team /> },
  ];
}
