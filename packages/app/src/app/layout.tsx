import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Self-hosted brand font. next/font/local emits the @font-face + a
// `<link rel="preload">` at SSR (before any JS), so the static preloader
// below renders in the real glyphs — no build-time or runtime CDN request.
// Vendored latin variable woff2 (weights 100–800). Source: fonts/OFL.txt.
const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin-var.woff2",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--font-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "Stave — Engine-agnostic live coding editor",
  description:
    "Engine-agnostic live coding editor — any engine, any viz, any synth",
};

// `viewport-fit=cover` (#2007): a phone only reports its notch and home indicator
// (`env(safe-area-inset-*)`) to a page that asks to be laid out under them; without
// it those read as zero and the browser letterboxes the page instead. The app's shell
// then pads itself by the insets (page.tsx). No `maximum-scale` and no
// `user-scalable`: pinch-zooming the whole page is an accessibility need.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetbrainsMono.variable} style={{ height: "100%" }} suppressHydrationWarning>
      <head>
        {/* Set data-stave-theme before first paint so CSS vars resolve
            immediately — prevents a dark flash when the user chose light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('stave:editorTheme') || 'dark';
                  var resolved = t === 'light' ? 'light'
                    : t === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
                    : 'dark';
                  document.documentElement.setAttribute('data-stave-theme', resolved);
                } catch (e) {}
              })();
            `,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes spin { to { transform: rotate(360deg) } }
              @keyframes pulse { 0%,100% { opacity: 0.4 } 50% { opacity: 1 } }
              #stave-preloader {
                position: fixed; inset: 0; z-index: 9999;
                background: var(--bg-app);
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                font-family: var(--font-mono), ui-monospace, monospace;
                transition: opacity 0.3s ease-out;
              }
              #stave-preloader.hidden { opacity: 0; pointer-events: none; }
              #stave-preloader h1 {
                font-size: 32px; font-weight: 700; color: var(--accent-strong);
                margin: 0; letter-spacing: -0.5px;
              }
              #stave-preloader .status {
                color: var(--text-secondary); font-size: 13px; margin-top: 12px;
                animation: pulse 2s ease-in-out infinite;
              }
              #stave-preloader .spinner {
                margin-top: 24px; width: 36px; height: 36px;
                border: 3px solid var(--border-subtle);
                border-top-color: var(--accent-strong); border-radius: 50%;
                animation: spin 0.8s linear infinite;
              }
            `,
          }}
        />
        {/* SuperSonic loaded dynamically in SonicPiEngine — no script tag needed */}
      </head>
      <body style={{ minHeight: "100%", display: "flex", flexDirection: "column", margin: 0, background: "var(--bg-app)" }}>
        {/* Static shell shown before any JS runs. The `.status` line is
            updated live by the bootstrap (EditorWrapper) to reflect the real
            phase — loading the workspace, opening the project, preparing the
            editor — instead of fake timed step labels. */}
        <div id="stave-preloader">
          <h1>Stave</h1>
          <div className="status" id="stave-preloader-status">Starting up…</div>
          <div className="spinner" />
        </div>
        {children}
        {/* Page views for the project's Vercel Analytics tab (#2055): no cookies,
            nothing from the editor. Production builds only: in development the
            component fetches a debug script from va.vercel-scripts.com and logs
            every view, on every page load of every browser spec. */}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
