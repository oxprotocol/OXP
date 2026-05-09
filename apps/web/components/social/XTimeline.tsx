/**
 * Client-side embed for the @oxprotocol X (Twitter) timeline.
 *
 * Renders a `<a class="twitter-timeline">` placeholder, then loads
 * `widgets.js` which replaces it with the real iframe. We avoid
 * `next/script` so the script can mount inside a regular component
 * without the Next 16 head-script restriction.
 */
"use client";

import { useEffect, useRef } from "react";

interface XTimelineProps {
  handle: string;
  height?: number;
}

export function XTimeline({ handle, height = 520 }: XTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const SCRIPT_ID = "twitter-widgets-js";
    const existing = document.getElementById(
      SCRIPT_ID,
    ) as HTMLScriptElement | null;

    const renderTimeline = () => {
      const w = window as unknown as {
        twttr?: {
          widgets?: { load?: (el?: HTMLElement | null) => void };
        };
      };
      w.twttr?.widgets?.load?.(containerRef.current);
    };

    if (existing) {
      renderTimeline();
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.async = true;
    s.src = "https://platform.twitter.com/widgets.js";
    s.onload = renderTimeline;
    document.body.appendChild(s);
  }, []);

  return (
    <div ref={containerRef} className="x-timeline" style={{ minHeight: 200 }}>
      <a
        className="twitter-timeline"
        data-theme="dark"
        data-chrome="noheader nofooter transparent noborders"
        data-height={height}
        href={`https://twitter.com/${handle}?ref_src=twsrc%5Etfw`}
      >
        Posts by @{handle}
      </a>
    </div>
  );
}
