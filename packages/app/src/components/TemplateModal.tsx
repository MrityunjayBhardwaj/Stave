"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { TEMPLATES, type ProjectTemplate } from "../templates";
import { TemplateIcon } from "./TemplateIcon";

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, templateId: string) => void;
}

export function TemplateModal({ open, onClose, onCreate }: TemplateModalProps) {
  const [selectedId, setSelectedId] = useState<string>("starter");
  const [name, setName] = useState("Untitled");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input on open
  useEffect(() => {
    if (open && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleCreate = useCallback(() => {
    if (!name.trim()) return;
    onCreate(name.trim(), selectedId);
  }, [name, selectedId, onCreate]);

  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>New Project</h2>
          <button style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.sectionLabel}>Choose a template</div>
          <div style={styles.grid}>
            {TEMPLATES.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                selected={t.id === selectedId}
                onSelect={() => setSelectedId(t.id)}
              />
            ))}
          </div>
          <div style={styles.note}>
            Every project also includes the built-in visualisers in <code>preset/viz</code>, ready to edit.
          </div>
        </div>

        <div style={styles.footer}>
          <div style={styles.nameRow}>
            <label style={styles.nameLabel}>Project name</label>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              style={styles.nameInput}
              placeholder="Untitled"
            />
          </div>
          <div style={styles.actions}>
            <button style={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              style={{ ...styles.createBtn, ...(!name.trim() ? styles.createBtnDisabled : {}) }}
              onClick={handleCreate}
              disabled={!name.trim()}
            >
              Create Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template, selected, onSelect,
}: {
  template: ProjectTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        ...styles.card,
        ...(selected ? styles.cardSelected : {}),
      }}
    >
      <div style={styles.cardIcon}><TemplateIcon templateId={template.id} size={24} /></div>
      <div style={styles.cardName}>{template.name}</div>
      <div style={styles.cardDesc}>{template.description}</div>
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  modal: {
    width: 720,
    maxWidth: "90vw",
    maxHeight: "85vh",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column" as const,
    color: "var(--text-chrome)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-icon)",
    fontSize: 24,
    cursor: "pointer",
    padding: "0 4px",
    lineHeight: 1,
  },
  body: {
    padding: "16px 20px",
    overflow: "auto",
    flex: 1,
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    marginBottom: 10,
    fontWeight: 600,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12,
  },
  card: {
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: 16,
    cursor: "pointer",
    textAlign: "left" as const,
    color: "var(--text-chrome)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    transition: "all 0.1s",
    minHeight: 120,
  },
  cardSelected: {
    background: "var(--bg-hover)",
    border: "1px solid var(--accent)",
    boxShadow: "0 0 0 1px var(--accent)",
  },
  cardIcon: {
    display: "flex",
    height: 28,
    alignItems: "center",
  },
  note: {
    marginTop: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  },
  cardName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  cardDesc: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    lineHeight: 1.4,
  },
  footer: {
    borderTop: "1px solid var(--border-subtle)",
    padding: "14px 20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  nameLabel: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    minWidth: 90,
  },
  nameInput: {
    flex: 1,
    background: "var(--bg-input)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    color: "var(--text-primary)",
    fontSize: 13,
    padding: "6px 10px",
    outline: "none",
    fontFamily: "inherit",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  cancelBtn: {
    background: "none",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    color: "var(--text-chrome)",
    padding: "6px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  createBtn: {
    background: "var(--accent-strong)",
    border: "1px solid var(--accent)",
    borderRadius: 4,
    color: "#ffffff",
    padding: "6px 14px",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 600,
    fontFamily: "inherit",
  },
  createBtnDisabled: {
    background: "var(--bg-hover)",
    border: "1px solid var(--border-strong)",
    color: "var(--text-muted)",
    cursor: "default",
  },
};
