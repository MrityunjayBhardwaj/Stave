"use client";

import React from "react";
import { templateLanguages } from "../templates";
import { FileTypeIcon } from "./FileTypeIcon";

/**
 * A project template's mark (#2076): the logos of the files it creates, the
 * same ones the file tree shows. A template that creates no file of its own
 * (Blank) shows a plain page.
 */
export function TemplateIcon({ templateId, size = 14 }: { templateId: string; size?: number }): React.ReactElement {
  const languages = templateLanguages(templateId);
  return (
    <span style={{ display: "inline-flex", gap: Math.round(size / 4), flex: "none", color: "var(--text-icon)" }}>
      {languages.length === 0 ? (
        <FileTypeIcon language={undefined} size={size} />
      ) : (
        languages.map((l) => <FileTypeIcon key={l} language={l} size={size} />)
      )}
    </span>
  );
}
