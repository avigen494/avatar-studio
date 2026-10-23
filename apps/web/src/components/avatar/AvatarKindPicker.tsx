"use client";

import { Camera, Wand2 } from "lucide-react";
/** The two ways to start an avatar: record yourself, or design a presenter with AI. */
export function AvatarKindPicker({ value, onChange }: { value: "real_person" | "designed"; onChange: (v: "real_person" | "designed") => void }) {
  const options = [
    {
      value: "real_person" as const,
      icon: <Camera size={20} />,
      title: "Record myself",
      body: "A 15-second clip with the consent line. Your face, your gestures, real-footage videos.",
    },
    {
      value: "designed" as const,
      icon: <Wand2 size={20} />,
      title: "Design a presenter",
      body: "Describe a presenter and pick one of three AI candidates. No recording, no consent needed.",
    },
  ];
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Kind of avatar">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={[
              "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
              active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2",
            ].join(" ")}
          >
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? "bg-accent text-on-accent" : "bg-surface-2 text-fg"}`}>{o.icon}</span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">{o.title}</span>
              <span className="block text-sm text-muted">{o.body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
