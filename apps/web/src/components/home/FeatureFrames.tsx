"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { frames } from "./frames";
import { Icon } from "./icons";
import "./home.css";

/** Seconds each frame shows when cycling on its own, and after someone picks one. */
const STEP = 6;
const HOLD = 20;

/**
 * The home page's app window: eight frames of the real app that cycle on their own.
 * The progress bar's CSS animation is the timer, so pausing it (mouse over the window,
 * the pause button, the tab hidden or scrolled away) pauses the cycle exactly.
 */
export default function FeatureFrames({ retentionDays }: { retentionDays: number }) {
  const list = frames(retentionDays);
  const [active, setActive] = useState(0);
  const [run, setRun] = useState(0);
  const [dur, setDur] = useState(STEP);
  const [hover, setHover] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [reduce, setReduce] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduce(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const select = useCallback((i: number, secs: number) => {
    setActive(i);
    setDur(secs);
    setRun((r) => r + 1);
  }, []);

  const onKey = (e: KeyboardEvent) => {
    const n = list.length;
    const to = e.key === "ArrowRight" ? (active + 1) % n : e.key === "ArrowLeft" ? (active - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to, HOLD);
    tabs.current[to]?.focus();
  };

  const still = reduce;
  const paused = hover || stopped || offscreen;

  return (
    <div className="ff-host" ref={host} id="features">
      <div
        className={`ff${paused ? " paused" : ""}${still ? " still" : ""}`}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      >
        <div className="ff-tabs" role="tablist" aria-label="What SureFrame does" onKeyDown={onKey}>
          {list.map((f, i) => (
            <button
              key={f.key}
              ref={(el) => { tabs.current[i] = el; }}
              id={`ff-tab-${f.key}`}
              role="tab"
              type="button"
              aria-selected={i === active}
              aria-controls={`ff-panel-${f.key}`}
              tabIndex={i === active ? 0 : -1}
              className="ff-tab"
              onClick={() => select(i, HOLD)}
            >
              {f.icon}
              {f.tab}
              <span className="ff-pg" aria-hidden="true">
                {i === active && (
                  <span
                    key={`${active}-${run}`}
                    style={{ position: "absolute", inset: 0, ["--dur" as string]: `${dur}s` }}
                    className="ff-pgbar"
                    onAnimationEnd={() => !still && select((active + 1) % list.length, STEP)}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="ff-window">
          <div className="ff-bar">
            <div className="t">
              <span className="ff-dots" aria-hidden="true"><i /><i /><i /></span>
              <span><b>{list[active].title}</b> · {list[active].detail}</span>
            </div>
            <div className="r">
              <span className="ff-lock">{Icon.lockFilled}Encrypted</span>
              {!still && (
                <button
                  type="button"
                  className="ff-pause"
                  aria-label={stopped ? "Play the feature tour" : "Pause the feature tour"}
                  aria-pressed={stopped}
                  onClick={() => setStopped((s) => !s)}
                >
                  {stopped ? Icon.play : Icon.pause}
                </button>
              )}
            </div>
          </div>
          {list.map((f, i) => (
            <div key={f.key} id={`ff-panel-${f.key}`} role="tabpanel" aria-labelledby={`ff-tab-${f.key}`} tabIndex={0} hidden={i !== active} className="ff-panel" style={{ ["--dur" as string]: `${dur}s` }}>
              {/* Started afresh with each turn, so a frame with steps inside it (To-dos/Reminders) keeps time with the bar. */}
              <div key={i === active ? run : "idle"} style={{ display: "contents" }}>{f.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
