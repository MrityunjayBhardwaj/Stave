import { StrudelEditorDynamic } from "../components/EditorWrapper";

export default function Home() {
  return (
    <main
      style={{
        height: "100dvh",
        width: "100%",
        // Keep everything inside the screen's safe area (#2007): a notch at the top
        // or, turned, at either side, and the home indicator under the bottom strip.
        // The shell is the one place that pads; nothing inside it reads the insets.
        // On a screen with no cut-outs every inset is zero and this does nothing.
        boxSizing: "border-box",
        paddingTop: "env(safe-area-inset-top)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        background: "var(--bg-app)",
        display: "flex",
        flexDirection: "column",
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        overflow: "hidden",
      }}
    >
      <StrudelEditorDynamic />
    </main>
  );
}
