import type { Facing } from "@/lib/recorder/media";

// Which cameras a device offers to choose from, shared by the recorder (components/Recorder.tsx) and video replies
// (components/ReplyComposer.tsx, Decision 14): a phone or tablet picks Front or Rear, a computer picks from its list.

/** A phone (not a tablet or computer): a touch screen with no mouse, small on its shorter side. */
export function isPhone() {
  const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (ua.userAgentData?.mobile) return true;
  return /iPhone|Android.+Mobile|Mobi/i.test(navigator.userAgent) || (matchMedia("(pointer: coarse) and (hover: none)").matches && Math.min(screen.width, screen.height) < 600);
}

/**
 * A phone or tablet: a touch screen and a mobile browser. These list every lens (wide, ultra-wide, zoom) as its own
 * camera, so they choose a side instead. iPads say they're a Mac, so a Mac with a touch screen counts too.
 */
export function hasFrontAndBack() {
  const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (ua.userAgentData?.mobile) return true;
  const mobile = /iPhone|iPad|iPod|Android|Mobi/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return mobile && matchMedia("(any-pointer: coarse)").matches;
}

/**
 * The sides a phone or tablet has cameras on, when there's a choice to make. With one camera there's nothing to
 * choose; a browser that doesn't say which way its cameras face is taken to have both.
 */
export function cameraSides(cams: MediaDeviceInfo[]): Facing[] {
  if (cams.length < 2) return [];
  const said = cams.map((d) => {
    try {
      return (d as InputDeviceInfo).getCapabilities?.().facingMode ?? [];
    } catch {
      return [];
    }
  });
  if (said.some((f) => f.length === 0)) return ["user", "environment"];
  return (["user", "environment"] as const).filter((side) => said.some((f) => f.includes(side)));
}
