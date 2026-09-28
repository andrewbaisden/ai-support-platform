"use client";

import { useState } from "react";

/** A read-only value with a copy button, e.g. a widget key or snippet. */
export function CopyField({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre className="flex-1 overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            {value}
          </pre>
        ) : (
          <code className="flex-1 break-all rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            {value}
          </code>
        )}
        <button
          type="button"
          aria-label={`${copied ? "Copied" : "Copy"} ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
