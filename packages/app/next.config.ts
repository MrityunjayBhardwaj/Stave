import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only transpile the local workspace package — it ships TypeScript/JSX source.
  // The @strudel/* and @kabelsalat/* packages are pre-compiled ESM bundles;
  // adding them to transpilePackages causes Turbopack to try statically resolving
  // their internal new URL("assets/...", import.meta.url) worker references and
  // fail with "Module not found: Can't resolve <dynamic>".
  transpilePackages: ["@stave/editor"],

  // #2381 — the build type-checks the shipped code only, with no incremental
  // cache, so a cache Vercel restores can't turn it red. Tests are checked in
  // CI against tsconfig.json. The why is in tsconfig.build.json.
  typescript: { tsconfigPath: "tsconfig.build.json" },

  // #2352 — PGlite (dev and tests' in-process Postgres) loads its WebAssembly
  // and data files from its own package folder at runtime; bundling it breaks
  // those paths. Production uses Neon and never loads it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // …and keep its ~20 MB (WebAssembly, extension tarballs) out of every
  // deployed function: a production build either has DATABASE_URL (Neon) or
  // no database at all (getDb() → null), so it never opens PGlite.
  outputFileTracingExcludes: {
    // Next joins each pattern onto this folder; pnpm keeps the package two levels up.
    "*": ["../../node_modules/.pnpm/@electric-sql+pglite@*/**", "node_modules/@electric-sql/pglite/**"],
  },

  // #322 — the /docs/[[...slug]] route handler reads the published docs site
  // (pages + assets) from ./docs-dist at runtime. On Vercel these files are not
  // on the serverless function's filesystem by default, so trace the whole tree
  // into the function bundle.
  outputFileTracingIncludes: {
    "/docs/[[...slug]]": ["./docs-dist/**/*"],
  },

  // ── Phase B pre-flight Q2 (#237) — cross-origin isolation for SharedArrayBuffer.
  // SAB is the planned per-frame viz-signal transport between the main thread and
  // the OffscreenCanvas worker; it requires `crossOriginIsolated`, which needs
  // COOP + COEP. We use COEP `credentialless` (NOT `require-corp`) so cross-origin
  // subresources (e.g. strudel.cc sample packs) still load without needing CORP
  // headers from the remote — `require-corp` would block them and silence drums.
  // OBSERVE (b-preflight-coep.spec.ts): crossOriginIsolated true + SAB allocatable
  // AND AudioWorklet/superdough still boots + triggers fire.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          // #2347 — only Stave may frame Stave, so another site can't overlay
          // it and trick a click on "Run it" or "Delete". 'self' still allows
          // the gallery's sandboxed preview (/gallery-player): the check
          // compares the framing page (Stave) with this response's URL, not
          // the frame's sandboxed origin. A full policy is #2365.
          //
          // #2374 — and only these may appear in a frame on a Stave page, checked
          // again each time a frame navigates itself, so a preview's code can't
          // put another site in the preview's place, even a page that never
          // finishes loading. 'self' is /gallery-player; the others are the start
          // screen's film and Cloudflare's Turnstile check. A frame with no URL
          // (the audio frame) needs no entry. A new embed must be added here.
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self'; frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com",
          },
        ],
      },
      // #2374 — the preview's own page holds no embeds, and it runs the entry's
      // code, so that code may put no site in a frame of its own: the check above
      // reads the page HOLDING a frame, so it doesn't reach a frame nested in the
      // preview. Same key as above, so this replaces it on this path (the last
      // match wins): keep frame-ancestors.
      {
        source: "/gallery-player",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'; frame-src 'none'" }],
      },
      // #2343 — the gallery's preview frame (`/gallery-player`, sandboxed with an
      // opaque origin) loads these files from an origin that isn't its own. Without
      // this header the browser hides every error its code throws later as
      // "Script error.", drops its rejected promises unreported, and refuses its
      // font. They are the same public files anyone can download.
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },

  // #2343 — fetch the app's scripts in CORS mode (with the header above), so a
  // page with an opaque origin gets their errors in full. Same-origin pages are
  // unaffected: a CORS request to your own origin always succeeds.
  crossOrigin: "anonymous",

  // ── #322 — serve the @stave/docs (Astro Starlight) site under /docs.
  // DEV: the Astro dev server runs on :4321 with the same '/docs/' base — forward
  // there so the MenuBar Docs button works against live docs without a build step.
  // PROD: the src/app/docs/[[...slug]] route handler serves the whole site (pages
  // and assets) from ./docs-dist, so no prod rewrite is needed. The output is kept
  // out of public/ because Next's public-static handler shadows the nested
  // directory clean-URLs (verified) — see the route handler for the full why.
  async rewrites() {
    if (process.env.NODE_ENV === "development") {
      return [
        // The Astro dev server (base '/docs/') serves the home page only at the
        // trailing-slash URL — forward the bare /docs to /docs/ so it resolves.
        // NOTE: this proxies the docs PAGES so the in-app Docs button lands
        // somewhere in dev, but Astro/Vite serve their dev stylesheets + client
        // from root-level virtual paths (/@fs, /src, /node_modules/.vite, the HMR
        // socket) that we deliberately do NOT proxy — chasing them all is fragile.
        // For fully-styled docs while authoring, open http://localhost:4321/docs/
        // directly. PROD (the route handler) serves everything correctly.
        { source: "/docs", destination: "http://localhost:4321/docs/" },
        { source: "/docs/:path*", destination: "http://localhost:4321/docs/:path*" },
      ];
    }
    return [];
  },
};

export default nextConfig;
