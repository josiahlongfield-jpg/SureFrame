import type { ReactNode } from "react";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ children, filled }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...(filled ? { fill: "currentColor" } : stroke)}>
      {children}
    </svg>
  );
}

/** Line icons for the home page, drawn on a 24px grid. */
export const Icon = {
  lock: <Svg><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  lockFilled: <Svg filled><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" /></Svg>,
  shield: <Svg><path d="M12 3l8 3.5v5.5c0 4.8-3.4 8.3-8 9-4.6-.7-8-4.2-8-9V6.5z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></Svg>,
  noAccount: <Svg><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5 1.6 0 3 .3 4.3.9" /><path d="M17 17l4 4M21 17l-4 4" /></Svg>,
  bolt: <Svg><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></Svg>,
  plug: <Svg><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5" /></Svg>,
  browser: <Svg><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></Svg>,
  record: <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" fill="currentColor" /></svg>,
  send: <Svg><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" /></Svg>,
  reply: <Svg><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Svg>,
  todo: <Svg><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18h.01" /></Svg>,
  brand: <Svg><circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" /><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2a5.5 5.5 0 0 0 5.5-5.5C22 6 17.5 2 12 2z" /></Svg>,
  ai: <Svg><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></Svg>,
  cloud: <Svg><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z" /><path d="M9.5 13.5l2 2 3.5-4" /></Svg>,
  team: <Svg><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.9.7 3 2.4 3 5.2" /></Svg>,
  monitor: <Svg><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Svg>,
  bell: <Svg><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Svg>,
  repeat: <Svg><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></Svg>,
  pause: <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>,
  play: <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>,
};

/** The presenter in the camera circle. */
export function Face() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="40" r="17" fill="#f1c7a8" />
      <path d="M33 34c0-12 8-19 17-19s17 7 17 18c-4-6-10-8-17-8s-13 3-17 9z" fill="#3b2a20" />
      <path d="M14 104c2-22 17-34 36-34s34 12 36 34z" fill="#fff" fillOpacity=".92" />
    </svg>
  );
}
