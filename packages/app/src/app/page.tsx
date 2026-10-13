import { StrudelEditorDynamic } from "../components/EditorWrapper";

export default function Home() {
  return (
    <main
      style={{
        // As tall as the browser is showing. While a phone's keyboard is up that is
        // less than the page (#2004): the editor package measures it and sets the
        // variable, and `top` follows a page the browser has slid up under the
        // keyboard. With no keyboard neither is set and this is the full height.
        height: "var(--stave-visible-height, 100dvh)",
        position: "relative",
        top: "var(--stave-visible-top, 0px)",
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
