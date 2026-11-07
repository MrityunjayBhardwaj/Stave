import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

/**
 * #2402 — the privacy policy, at /privacy (Google's consent screen links here).
 *
 * Every statement describes what the code does today. When a change alters what
 * is kept, who sees it or who it is sent to, change this page in the same PR and
 * move LAST_UPDATED. Rendered on the server so it reads without any JavaScript,
 * which is why it sits outside app/(editor): the editor's loading.tsx would wrap
 * it in a boundary whose content stays hidden until a script reveals it.
 */

export const metadata: Metadata = {
  title: "Privacy Policy — Stave",
  description: "What Stave keeps about you, who can see it, and how to delete it.",
};

const LAST_UPDATED = "7 November 2026";
const CONTACT_EMAIL = "support@stave.live";

const styles: Record<string, CSSProperties> = {
  main: {
    width: "100%",
    maxWidth: 720,
    margin: "0 auto",
    padding: "48px 24px 96px",
    boxSizing: "border-box",
    color: "var(--text-body)",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: 16,
    lineHeight: 1.65,
  },
  h1: { color: "var(--text-primary)", fontSize: 32, lineHeight: 1.2, margin: "0 0 8px" },
  h2: { color: "var(--text-primary)", fontSize: 20, lineHeight: 1.3, margin: "40px 0 8px" },
  updated: { color: "var(--text-secondary)", fontSize: 14, margin: "0 0 24px" },
  link: { color: "var(--accent-strong)" },
  th: { textAlign: "left", padding: "8px 12px 8px 0", borderBottom: "1px solid var(--border-strong)", color: "var(--text-primary)" },
  td: { verticalAlign: "top", padding: "8px 12px 8px 0", borderBottom: "1px solid var(--border-subtle)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 15 },
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <h2 style={styles.h2}>{title}</h2>
    {children}
  </section>
);

const Mail = () => (
  <a style={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);

const SERVICES: ReadonlyArray<readonly [string, string, string]> = [
  ["Vercel", "Hosts the site, stores gallery files and private links, and counts page views", "Every visit"],
  ["Neon", "Runs the database that holds accounts, profiles, gallery records and reports", "When you use the gallery or sign in"],
  ["Cloudflare Turnstile", "Checks that a person, not a bot, is publishing, reporting or making a private link", "Publishing, reporting, or making a private link when not signed in"],
  ["GitHub, Google", "Sign you in", "Signing in with that service"],
  ["strudel.b-cdn.net, GitHub, felixroos.github.io", "Serve sound samples and instruments", "Opening the app or playing music"],
  ["unpkg.com", "Serves the Sonic Pi engine's code", "Starting the Sonic Pi engine"],
  ["YouTube (youtube-nocookie.com)", "Plays the start screen's video", "Only after you press play on it"],
];

export default function PrivacyPage() {
  return (
    <main style={styles.main} data-testid="privacy-page">
      {/* The root layout's loading screen covers every page until the app removes it, and this page has no app. */}
      <style>{`
        #stave-preloader { display: none; }
        [data-testid="privacy-page"] p { margin: 0 0 12px; }
      `}</style>

      <h1 style={styles.h1}>Privacy Policy</h1>
      <p style={styles.updated}>Last updated {LAST_UPDATED}</p>
      <p>
        Stave is a live coding music editor at{" "}
        <a style={styles.link} href="/">
          stave.live
        </a>
        . You can use it without an account, and your projects stay in your browser. This page says what we keep when
        you sign in, publish or share, who can see it, and how to have it deleted. Questions: <Mail />.
      </p>

      <Section title="If you don't sign in">
        <p>
          Your projects are kept in your browser (IndexedDB and local storage), not on our servers, and there is no
          cloud sync. A project leaves your browser only when you share or publish it. Clearing your browser&apos;s
          data for this site deletes them, so export anything you want to keep.
        </p>
        <p>
          We count page views with Vercel Web Analytics, which uses no cookies. It records the page&apos;s path, which
          for a private link includes the link&apos;s id but never its key.
        </p>
      </Section>

      <Section title="Private links">
        <p>
          A private link&apos;s project is encrypted in your browser with a key that exists only in the link, after the{" "}
          <code>#</code>. Browsers don&apos;t send that part to servers, so we never see the key or the project. We store
          the encrypted data, with no expiry, until the link is revoked. Only someone with the link can open it, so
          treat it like a password.
        </p>
        <p>
          You can revoke a link from the browser that made it, or from your account if it is listed there. If you are
          signed in, your account lists each link&apos;s id, project name and date, and signing in adds the links made
          earlier in that browser. Those names are not encrypted.
        </p>
        <p>
          If you use a long link instead, nothing is uploaded: the whole project is in the link itself, not encrypted,
          so anyone who has the link can read it.
        </p>
      </Section>

      <Section title="If you sign in with GitHub or Google">
        <p>
          When you sign in and use the gallery or private links, we keep your account id with that service, your email
          address, your name, your avatar and, for GitHub, your username. We don&apos;t receive your password and we
          don&apos;t keep access tokens for your GitHub or Google account.
        </p>
        <p>
          <strong>Public:</strong> your profile shows your name, avatar, GitHub username, which service you signed in
          with, and any bio you write.
        </p>
        <p>
          <strong>Private:</strong> your email is used only to contact you about what you publish. No part of Stave
          shows it to anyone, including other users and gallery admins, and we don&apos;t sell it or send marketing
          email.
        </p>
      </Section>

      <Section title="What you publish to the gallery">
        <p>
          Anything you publish is public. Anyone can open it, read its code and copy it, including its files, picture,
          title, kind, tags, your profile name and the date. Collections you make are public too. Don&apos;t publish
          anything you wouldn&apos;t want others to see.
        </p>
      </Section>

      <Section title="Deleting what you published">
        <p>
          <strong>When you delete your own entry</strong>, we delete it at once and keep nothing: its record, its files,
          its place in any collection and any reports about it. Lists and pictures already cached may take up to about
          five minutes to catch up.
        </p>
        <p>
          <strong>When an admin removes an entry</strong>, it is hidden from everyone at once. Its content and your email
          are kept for 30 days so that a mistaken removal can be reversed, and are deleted within a day after that. We
          keep a record of the removal after that: the entry&apos;s title, kind, tags, your profile name and the dates, along
          with any reports about it and the action log entry below.
        </p>
      </Section>

      <Section title="Reports and moderation">
        <p>
          Anyone can report an entry, without signing in. We keep what you wrote and when, not who sent it, and gallery
          admins read it. Please don&apos;t put personal details in a report. Reports stay on record unless the entry&apos;s
          author deletes the entry.
        </p>
        <p>
          When an admin acts, the action log records the admin&apos;s name and account id, what they did, to what, when
          and why. Only admins can read it, and it has no time limit.
        </p>
        <p>
          If an admin suspends an account, we keep the reason and the dates against it until the suspension is lifted or
          the account is deleted. Suspensions aren&apos;t shown publicly. If the admin also takes down everything the
          account published, its profile and collections are hidden while the suspension lasts.
        </p>
      </Section>

      <Section title="Limits on abuse">
        <p>
          To slow abuse we count requests over short periods: per account when you are signed in, and per network
          address when you are not. These counters hold only a one-way hash, the current period&apos;s start and a count,
          never your address itself. Old counters aren&apos;t removed automatically, and can&apos;t be traced back to you
          without already knowing your address and our secret key.
        </p>
        <p>
          When you publish or report, or make a private link without being signed in, Cloudflare Turnstile runs a check
          in your browser, and our server sends Cloudflare the result along with your network address. Cloudflare handles
          this under its own privacy policy.
        </p>
      </Section>

      <Section title="Cookies and browser storage">
        <p>
          Using Stave without signing in sets no cookies of ours. Signing in sets a session cookie: encrypted, readable
          only by our server, holding your name, email, avatar and account id. It expires after 30 days without use. The
          sign-in process also uses short-lived security cookies. We use no advertising or tracking cookies.
        </p>
        <p>
          Your browser also stores your projects, settings, and the tokens that let you manage links and entries you
          made. These stay on your device.
        </p>
      </Section>

      <Section title="Services we use">
        <p>
          These services receive your network address when your browser or our server connects to them, and each
          handles it under its own policy. Vercel also keeps server logs of requests to the site.
        </p>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Service</th>
              <th style={styles.th}>What for</th>
              <th style={styles.th}>When</th>
            </tr>
          </thead>
          <tbody>
            {SERVICES.map(([name, what, when]) => (
              <tr key={name}>
                <td style={styles.td}>{name}</td>
                <td style={styles.td}>{what}</td>
                <td style={styles.td}>{when}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Avatars and images in profile bios load directly from wherever they are hosted. A project you run, including
          one from the gallery or a shared link, can also connect to other sites.
        </p>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can delete your entries, collections and links yourself. There is no button to delete your account yet, so
          email <Mail /> from the address on your account and we will delete your account, profile and email, and tell
          you when it is done. Use the same address for questions, or to ask what we hold about you.
        </p>
      </Section>

      <Section title="Changes to this page">
        <p>When what we do changes, we update this page and the date at the top.</p>
      </Section>
    </main>
  );
}
