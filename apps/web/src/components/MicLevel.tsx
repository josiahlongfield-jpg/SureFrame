"use client";

import { useEffect, useRef, useState } from "react";
import { getMic, stopAll } from "@/lib/recorder/media";

/** How loud counts as sound (RMS of the signal, 0 to 1). */
const HEARD = 0.02;
/** Silence this long before anything has been heard gets a warning. */
const QUIET_MS = 6000;
/** After sound, this much silence means "not hearing anything right now". */
const GONE_MS = 2500;

type State = "starting" | "listening" | "hearing" | "silent" | "quiet" | "stopped" | "blocked";

/**
 * A live level bar for the chosen microphone, shown while setting up, so
 * nobody records a whole video before finding out the mic wasn't working.
 * The message follows what the microphone is picking up right now (it never
 * just says "working"), and notices a headset being switched off or
 * unplugged. It only measures loudness on this device; nothing is recorded or sent.
 */
export default function MicLevel({ deviceId, stream: given }: { deviceId?: string; stream?: MediaStream | null }) {
  const bar = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("starting");
  const [label, setLabel] = useState("");
  // Bumped when devices change (a headset switched on or off), to reopen the microphone.
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    const onChange = () => setRestart((n) => n + 1);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let frame = 0;
    let cancelled = false;
    setState("starting");

    // Measure a stream the caller already has open (a reply being recorded), or open the chosen mic.
    (given ? Promise.resolve(given) : getMic(deviceId))
      .then((s) => {
        if (cancelled) return given ? undefined : stopAll(s);
        if (!given) stream = s;
        const track = s.getAudioTracks()[0];
        setLabel(track?.label ?? "");
        // The browser ends or mutes the track when the device is switched off or unplugged.
        const lost = () => !cancelled && setState("stopped");
        track?.addEventListener("ended", lost);
        track?.addEventListener("mute", lost);
        track?.addEventListener("unmute", () => !cancelled && setState("listening"));

        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const started = performance.now();
        let level = 0;
        let lastSound = 0;
        let shown: State = "starting";
        const show = (next: State) => {
          if (next !== shown) setState((shown = next));
        };
        show("listening");
        const tick = () => {
          if (track?.readyState === "ended" || track?.muted) {
            show("stopped");
          } else {
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const v of samples) sum += v * v;
            const rms = Math.sqrt(sum / samples.length);
            // Rise quickly, fall gently, so speech reads as a steady bar.
            level = Math.max(rms, level * 0.9);
            const now = performance.now();
            if (rms > HEARD) lastSound = now;
            if (lastSound && now - lastSound < GONE_MS) show("hearing");
            else if (lastSound) show("silent");
            else show(now - started > QUIET_MS ? "quiet" : "listening");
          }
          if (bar.current) bar.current.style.width = `${shown === "stopped" ? 0 : Math.min(100, Math.round(Math.sqrt(level) * 220))}%`;
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => !cancelled && setState("blocked"));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopAll(stream);
      void ctx?.close().catch(() => {});
    };
  }, [deviceId, restart, given]);

  const warn = state === "quiet" || state === "stopped" || state === "blocked";
  return (
    <div className="grid gap-1" data-testid="mic-level" data-state={state}>
      <div className="h-2 overflow-hidden rounded-full bg-line-strong" aria-hidden>
        <div ref={bar} className={`h-full w-0 rounded-full transition-[width] duration-75 ${warn ? "bg-amber-500" : "bg-emerald-500"}`} />
      </div>
      <span className={`text-xs ${warn ? "text-warn-fg" : "text-dim"}`} aria-live="polite">
        {state === "starting" && "Checking your microphone…"}
        {state === "listening" && "Say something. The bar should move when you speak."}
        {state === "hearing" && "Picking up sound. Make sure the bar moves with your voice, not just background noise."}
        {state === "silent" && "No sound right now. Speak to check it's still picking you up."}
        {state === "quiet" && `We can't hear anything yet. Check the microphone is switched on and not muted${given ? "" : ", and the right one is selected above"}.`}
        {state === "stopped" && `This microphone has stopped sending sound. Check it's switched on and connected${given ? "" : ", or choose another one above"}.`}
        {state === "blocked" && `We can't use this microphone. Allow it in your browser's address bar${given ? "" : ", or pick another one above"}.`}
      </span>
      {label && state !== "blocked" && <span className="text-xs text-dim" data-testid="mic-in-use">Listening to: {label}</span>}
    </div>
  );
}
