// Talk story scheduling: lay meetings into the director's open blocks, then write
// calendar files any calendar app can import. No calendar account needed.

// blocks: [{ date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }], people: [{ name }]
export function layoutMeetings(blocks, people, minutes = 45, gap = 15) {
  const out = [];
  const queue = [...people];
  const sorted = [...blocks].sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  for (const b of sorted) {
    let t = new Date(`${b.date}T${b.start}`);
    const end = new Date(`${b.date}T${b.end}`);
    while (queue.length && t.getTime() + minutes * 60000 <= end.getTime()) {
      out.push({ person: queue.shift(), start: t, end: new Date(t.getTime() + minutes * 60000) });
      t = new Date(t.getTime() + (minutes + gap) * 60000);
    }
  }
  return { meetings: out, unscheduled: queue };
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const clean = (s) => String(s).replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

export function buildICS(events, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hui 360//Talk story//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${stamp(e.start)}-${clean(e.title).replace(/[^\w]/g, '')}@hui360`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${clean(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${clean(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${clean(e.location)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
