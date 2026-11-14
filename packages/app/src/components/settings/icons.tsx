"use client";

import React from "react";

// Small stroked glyphs for the shell tabs + section nav, ported from the
// approved mockup (#739). Kept in one place so SettingsShell / panels stay
// readable. All inherit `currentColor` so the active-state colouring in
// shellStyles.ts works.

const svg = (children: React.ReactNode, sw = 1.6): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}>
    {children}
  </svg>
);

export const IconSettings = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>,
    1.7,
  );

export const IconKeyboard = () =>
  svg(
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M7.5 13.5h9" />
    </>,
  );

export const IconSearch = () =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </>,
    1.8,
  );

export const IconAppearance = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 000 18c1.4 0 1.8-1.6 1-2.6-.7-.9-.2-2.4 1-2.4h1a4 4 0 004-4c0-5-3.6-9-8-9z" />
      <circle cx="8.5" cy="10" r="1" />
      <circle cx="15.5" cy="10" r="1" />
    </>,
  );

export const IconPattern = () =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 4v16M15 4v16" />
    </>,
  );

export const IconViz = () =>
  svg(
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </>,
  );

export const IconPerf = () =>
  svg(
    <>
      <path d="M4 15a8 8 0 0116 0" />
      <path d="M12 15l4-4" />
      <circle cx="12" cy="15" r="1.3" />
    </>,
  );

export const IconModules = () =>
  svg(
    <>
      <path d="M9 2v5M15 2v5M7 7h10v4a5 5 0 01-10 0z" />
      <path d="M12 16v6" />
    </>,
  );

// #2556 — four squares, one lifted out: the Extensions section
export const IconExtensions = () =>
  svg(
    <>
      <rect x="3" y="10" width="5.5" height="5.5" rx="1" />
      <rect x="3" y="16.5" width="5.5" height="5.5" rx="1" transform="translate(0 -1)" />
      <rect x="9.5" y="14.5" width="5.5" height="5.5" rx="1" />
      <rect x="14" y="3" width="6" height="6" rx="1" transform="rotate(12 17 6)" />
    </>,
  );

export const IconAliases = () =>
  svg(
    <>
      <path d="M4 4h8l8 8-8 8-8-8V4z" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </>,
  );

export const IconWarn = () =>
  svg(
    <>
      <path d="M12 8v5M12 16.5v.5" />
      <path d="M10.3 4l-7 12A1.5 1.5 0 004.6 18.4h14.8A1.5 1.5 0 0020.7 16l-7-12a1.5 1.5 0 00-2.6 0z" />
    </>,
    2,
  );
