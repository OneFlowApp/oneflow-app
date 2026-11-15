/** "Add to calendar" for a booked class: an .ics file opens straight in Apple, Google and Outlook calendars. */
export type CalendarClass = {
  id: string;
  title: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  location?: string | null;
  guide?: string | null;
};

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function addClassToCalendar(c: CalendarClass) {
  const start = new Date(c.startsAt);
  const end = c.endsAt ? new Date(c.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  const where = ["One Flow", c.location].filter(Boolean).join(" · ");
  const notes = [
    c.guide ? `With ${c.guide}` : null,
    /reformer/i.test(c.title) ? "Please remember to bring grippy socks." : null,
    "Your check-in QR is in the One Flow app under My bookings.",
  ]
    .filter(Boolean)
    .join("\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//One Flow//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${c.id}@oneflow`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(c.title)}`,
    `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc(notes)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT60M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(c.title)} in 1 hour`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${c.title.replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "-") || "class"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
