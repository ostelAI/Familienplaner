export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function toISO(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

// 1 = Montag … 7 = Sonntag
export function isoWeekday(d) {
  return ((d.getDay() + 6) % 7) + 1;
}

export function startOfWeek(d) {
  return addDays(d, 1 - isoWeekday(d));
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export const fmtDayMonth = d => `${d.getDate()}.${d.getMonth() + 1}.`;
export const fmtLong = d => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtClock = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
