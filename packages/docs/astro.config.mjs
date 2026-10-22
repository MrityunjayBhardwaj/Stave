import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import rehypeBaseInternalLinks from './rehype-base-internal-links.mjs'

// Deployed at stave.live/docs/ — Astro's `base` makes every generated
// URL (asset + internal link) include that prefix, so the Next app can
// serve the built output (published to app/docs-dist, served by the
// /docs/[[...slug]] route handler) and the dev rewrite can forward
// `/docs/:path*` to the Astro dev server running with the same base.
// Override via `STAVE_DOCS_BASE=/` for standalone preview.
const BASE = process.env.STAVE_DOCS_BASE ?? '/docs/'

export default defineConfig({
  site: 'https://stave.live',
  base: BASE,
  // Author-written content links (markdown bodies) are emitted verbatim by
  // Astro/Starlight — they don't get the `base` prefix that framework URLs do.
  // This plugin prefixes root-absolute internal links in content with BASE so
  // they resolve under `/docs/`. Base-agnostic: a no-op when BASE is `/`.
  markdown: {
    rehypePlugins: [[rehypeBaseInternalLinks, { base: BASE }]],
  },
  integrations: [
    starlight({
      title: 'Stave',
      description:
        'A music studio for Strudel in your browser: write the song as code, arrange it on a Timeline, edit it on a grid, mix it, and make visuals that react to it.',
      logo: { src: './src/assets/stave.svg' },
      // Override Hero to base-prefix splash action links — Starlight renders
      // them verbatim, and the rehype plugin can't reach frontmatter.
      components: {
        Hero: './src/components/Hero.astro',
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/MrityunjayBhardwaj/Stave' }],
      editLink: {
        baseUrl:
          'https://github.com/MrityunjayBhardwaj/Stave/edit/main/packages/docs/',
      },
      lastUpdated: true,
      pagefind: true,
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting started', link: '/getting-started/' },
            { label: 'Roadmap', link: '/roadmap/' },
          ],
        },
        {
          label: 'Studio',
          items: [
            { label: 'Timeline', link: '/studio/timeline/' },
            { label: 'Pattern', link: '/studio/pattern/' },
            { label: 'Mixer', link: '/studio/mixer/' },
            { label: 'Library', link: '/studio/library/' },
          ],
        },
        {
          label: 'Core concepts',
          items: [{ autogenerate: { directory: 'concepts' } }],
        },
        {
          label: 'Runtimes',
          items: [
            { label: 'Strudel', link: '/runtimes/strudel/' },
            { label: 'Sonic Pi', link: '/runtimes/sonicpi/' },
            { label: 'p5.js', link: '/runtimes/p5/' },
            { label: 'Hydra', link: '/runtimes/hydra/' },
            { label: 'GLSL / ShaderToy', link: '/runtimes/glsl/' },
          ],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'API reference',
          // Strudel reference omitted on this base — its vendored DocsIndex
          // (`strudel.json`) is a docs-site-only refactor not yet on `performance`.
          items: [
            { label: 'Sonic Pi', link: '/reference/sonicpi/' },
            { label: 'p5.js', link: '/reference/p5/' },
            { label: 'Hydra', link: '/reference/hydra/' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
})
