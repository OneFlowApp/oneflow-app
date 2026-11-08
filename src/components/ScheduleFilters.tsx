import { useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export type ScheduleFilterState = {
  types: string[];
  times: TimeOfDay[];
  guides: string[];
};

export const EMPTY_SCHEDULE_FILTERS: ScheduleFilterState = { types: [], times: [], guides: [] };

export const TIME_OF_DAY_OPTIONS: { value: TimeOfDay; label: string; hint: string }[] = [
  { value: "morning", label: "Morning", hint: "before 12:00" },
  { value: "afternoon", label: "Afternoon", hint: "12:00 to 17:00" },
  { value: "evening", label: "Evening", hint: "from 17:00" },
];

export function scheduleFilterCount(f: ScheduleFilterState): number {
  return f.types.length + f.times.length + f.guides.length;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** Tick box filters on the member schedule: class type, time of day and guide. */
export function ScheduleFilters({
  value,
  onChange,
  typeOptions,
  guideOptions,
  shown,
  total,
}: {
  value: ScheduleFilterState;
  onChange: (next: ScheduleFilterState) => void;
  typeOptions: string[];
  guideOptions: string[];
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const count = scheduleFilterCount(value);

  const group = (
    title: string,
    options: { value: string; label: string; hint?: string }[],
    selected: string[],
    set: (v: string) => void,
  ) =>
    options.length === 0 ? null : (
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {options.map((o) => {
            const id = `sf-${title}-${o.value}`.replace(/\s+/g, "-");
            return (
              <label key={o.value} htmlFor={id} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
                <Checkbox id={id} checked={selected.includes(o.value)} onCheckedChange={() => set(o.value)} />
                <span className="min-w-0 truncate">
                  {o.label}
                  {o.hint ? <span className="ml-1 text-[11px] text-muted-foreground">{o.hint}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#4a6b3c]" aria-hidden />
          Filter classes
          {count > 0 ? (
            <span className="rounded-full bg-[#a3b693] px-2 py-0.5 text-[11px] font-semibold text-white">
              {count}
            </span>
          ) : null}
          <ChevronDown
            className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {count > 0 ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_SCHEDULE_FILTERS)}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-4 border-t border-border px-3 py-3">
          {group(
            "Type",
            typeOptions.map((t) => ({ value: t, label: t })),
            value.types,
            (v) => onChange({ ...value, types: toggle(value.types, v) }),
          )}
          {group(
            "Time",
            TIME_OF_DAY_OPTIONS,
            value.times,
            (v) => onChange({ ...value, times: toggle(value.times, v as TimeOfDay) }),
          )}
          {group(
            "Guide",
            guideOptions.map((g) => ({ value: g, label: g })),
            value.guides,
            (v) => onChange({ ...value, guides: toggle(value.guides, v) }),
          )}
          {count > 0 ? (
            <p className="text-xs text-muted-foreground">
              Showing {shown} of {total} classes this day.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
