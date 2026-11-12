export default function Loading() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-app)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
      }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "var(--accent-strong)",
          margin: 0,
          letterSpacing: "-0.5px",
        }}
      >
        Stave
      </h1>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: 13,
          marginTop: 8,
        }}
      >
        Loading editor…
      </p>
      <div
        style={{
          marginTop: 24,
          width: 40,
          height: 40,
          border: "3px solid var(--border-subtle)",
          borderTop: "3px solid var(--accent-strong)",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </main>
  );
}
