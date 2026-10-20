# Contributing to Stave

Thank you for your interest in contributing to Stave! This document explains how to contribute and what to expect from the process.

## License

By contributing to Stave, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](./LICENSE).

**Stave does not use a CLA (Contributor License Agreement).** Your contributions remain yours, licensed under AGPL 3.0 in perpetuity. We will never re-license community contributions under a different license.

## Developer Certificate of Origin (DCO)

All commits must be signed off with the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). This certifies that you have the right to submit the code under the project's license.

To sign off, add `-s` to your commit command:

```bash
git commit -s -m "feat: add new feature"
```

This adds a `Signed-off-by: Your Name <your@email.com>` line to the commit message. If you forget, you can amend the last commit with:

```bash
git commit --amend -s
```

## How to Contribute

### Finding something to work on

- [**good first issue**](https://github.com/MrityunjayBhardwaj/Stave/labels/good%20first%20issue): small, self-contained changes. Each one has a comment saying where the code lives and how to check your change.
- [**help wanted**](https://github.com/MrityunjayBhardwaj/Stave/labels/help%20wanted): bigger or less charted, and very welcome.
- The **area** labels (`area: timeline`, `area: pattern`, `area: mixer`, `area: visuals` and so on) narrow the list to the part of Stave you know.

Comment on an issue before you start, so two people don't take the same one.

### Reporting Bugs

1. Search [existing issues](https://github.com/MrityunjayBhardwaj/stave/issues) first
2. If your bug isn't already reported, open a new issue with:
   - What you expected to happen
   - What actually happened
   - Steps to reproduce
   - Browser and OS version

### Proposing Features

Open an issue describing the feature, its motivation, and how it fits into Stave's direction. Discussion before implementation saves everyone time.

### Pull Requests

1. Fork the repository
2. Create a branch from `main` with a descriptive name (`fix/`, `feat/`, `chore/` prefix)
3. Make your changes
4. Run the test suite: `cd packages/editor && npx vitest run`
5. Run type checking: `cd packages/editor && npx tsc --noEmit`
6. If you touched pattern parsing, the notation model, or the visual-edit write-back path, also
   run the editing fidelity gate from the repo root: `pnpm gate:editing` (see below)
7. Sign off all commits (see DCO section above)
8. Open a PR against `main` with a clear description

#### The editing fidelity gate

The editing suites span two packages: the whole visual-editing subsystem in
`packages/editor/src/visualEdit` (notation model, write-back, chunk detection, panels), and the
corpus-wide reach, round-trip, locality and stress sweeps in `packages/app/tests/parity-corpus` —
which deep-import the editor's notation *source*. Because the app's pinned snapshots sit
downstream of the editor's model, a parsing or reach change can leave `packages/editor` fully green
while flipping app snapshots. Per-package green is not suite green, so run both together:

```bash
pnpm gate:editing          # both packages, one verdict (~8s)
pnpm gate:editing:editor   # visual-editing subsystem only, for a fast inner loop
pnpm gate:editing:app      # corpus reach/round-trip only
```

`pnpm gate:editing` runs both halves unconditionally — it deliberately does not stop at the first
failure, so one package's breakage can never hide the other's. It exits non-zero if either fails.

#### Five corpus tests skip on a fresh clone — that is expected

Some of the app-package sweeps are measured over an archive of real community tunes cached in
`packages/app/tests/parity-corpus/.bakery-runs/`. That directory is **gitignored on purpose**: the
tunes are unreviewed third-party source and the overwhelming majority declare no licence, so the
repo records how to fetch them rather than redistributing them.

So on a fresh clone five tests report **skipped**, and the gate is still green:

| test | what it measures |
|---|---|
| `miniSource-calibration.test.ts` | the resolver over 150 real tunes |
| `writer-census-eval.test.ts` | the reach transfer over the eval-first ask population |
| `1240-resolver-anchor-agreement.test.ts` | parse-only resolutions agree with eval-first ones |
| `song-period-sweep.test.ts` | the pinned per-document display-period baseline |
| `song-period-abstention.test.ts` | lane-abstention candidates against that baseline |

Skipped is the honest report here — the archive's absence is a fact about your machine, not a
failure of the code. If you are changing the resolver, the notation model, or display-period
detection, rebuild the archive first so those five actually run:

```bash
node packages/app/scripts/mini-corpus-manifest.mjs restore
```

It refetches every input by hash from the committed manifest
(`packages/app/tests/parity-corpus/mini-corpus-inputs.json`) and verifies each rebuilt file against
the sha256 recorded there, so the result is byte-exact or it fails loudly. It needs network access,
and it will refuse rather than half-rebuild if an upstream tune has since been deleted.

### Commit Style

We use [gitmoji](https://gitmoji.dev/) prefixes in commit messages:

```
<emoji> <type>: short summary

Problem: what was broken and why
Fix: what was changed and how it solves it
```

Common prefixes: `fix:`, `feat:`, `chore:`, `docs:`, `test:`, `refactor:`

## What NOT to Commit

The `.gitignore` is comprehensive, but please double-check that your PR does not include:

- AI tool configuration files (`CLAUDE.md`, `AGENTS.md`, `.cursor*`, `.aider*`)
- Personal documents, strategy notes, or thesis drafts
- Planning framework output (`.planning/`, `.anvi/`)
- Environment files (`.env`, `.env.local`)
- IDE configuration (`.vscode/`, `.idea/`)
- OS artifacts (`.DS_Store`, `Thumbs.db`)

## Development Setup

```bash
# Clone the repo
git clone https://github.com/MrityunjayBhardwaj/stave.git
cd stave

# Install dependencies
pnpm install

# Run the editor test suite
cd packages/editor && npx vitest run

# Start the dev server
cd packages/app && pnpm dev
```

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Questions?

Ask in [Discussions](https://github.com/MrityunjayBhardwaj/Stave/discussions). [SUPPORT.md](./SUPPORT.md) says where each kind of question goes. We're happy to help.
