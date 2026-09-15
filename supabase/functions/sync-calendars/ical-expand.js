// Wandelt einen iCal-Kalender (Google, iCloud, …) in einzelne Termine im Zeitraum [from, to] um.
// Wiederholungen (RRULE, EXDATE, verschobene Einzeltermine) werden aufgelöst,
// Uhrzeiten in die Zeitzone der Familie umgerechnet.
// ICAL (ical.js) wird hereingereicht, damit die Datei in Deno und im Browser läuft.

const MAX_ITERATIONS = 20000;
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return formatters.get(timeZone);
}

function isIanaZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    formatters.delete(tz);
    return false;
  }
}

function partsIn(timeZone, instant) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

function offsetMs(timeZone, instant) {
  const p = partsIn(timeZone, instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

// Wanduhrzeit in einer Zeitzone → UTC-Zeitpunkt
function wallToInstant(w, timeZone) {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const first = guess - offsetMs(timeZone, guess);
  return guess - offsetMs(timeZone, first);
}

const pad = n => String(n).padStart(2, '0');
const isoDate = p => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
const hhmm = p => `${pad(p.hour)}:${pad(p.minute)}`;

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function expandCalendar(ICAL, icsText, { from, to, timeZone = 'Europe/Berlin' }) {
  const root = new ICAL.Component(ICAL.parse(icsText));
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {}
  }

  // paramTzid: TZID-Parameter der DTSTART/DTEND-Zeile – ical.js vergisst ihn, wenn keine VTIMEZONE mitkommt
  const instantOf = (time, paramTzid) => {
    const w = { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second };
    const zoneId = time.zone?.tzid;
    if (zoneId === 'UTC' || time.zone === ICAL.Timezone.utcTimezone) return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    const tzid = zoneId && zoneId !== 'floating' ? zoneId : paramTzid;
    if (tzid && isIanaZone(tzid)) return wallToInstant(w, tzid);
    if (zoneId && zoneId !== 'floating') return time.toUnixTime() * 1000; // eigene VTIMEZONE, z. B. Outlook-Namen
    return wallToInstant(w, timeZone); // "schwebende" Uhrzeit = Ortszeit
  };
  const tzParam = (item, name) => item.component.getFirstProperty(name)?.getParameter('tzid') || undefined;

  const toRow = (item, start, end) => {
    const status = item.component.getFirstPropertyValue('status');
    if (status && String(status).toUpperCase() === 'CANCELLED') return null;

    const base = {
      uid: item.uid || null,
      title: (item.summary || '').trim() || '(Ohne Titel)',
      location: (item.location || '').trim() || null,
    };

    if (start.isDate) {
      const date = start.toString().slice(0, 10);
      let endDate = end && end.isDate ? addDaysISO(end.toString().slice(0, 10), -1) : date;
      if (endDate < date) endDate = date;
      return { ...base, date, end_date: endDate, start_time: null, end_time: null };
    }

    const startTz = tzParam(item, 'dtstart');
    const s = partsIn(timeZone, instantOf(start, startTz));
    const e = end ? partsIn(timeZone, instantOf(end, tzParam(item, 'dtend') || startTz)) : s;
    const date = isoDate(s);
    let endDate = isoDate(e);
    let endTime = hhmm(e);
    // Endet genau um Mitternacht → gehört noch zum Vortag
    if (endDate > date && endTime === '00:00') {
      endDate = addDaysISO(endDate, -1);
      endTime = '23:59';
    }
    if (endDate < date) endDate = date;
    return { ...base, date, end_date: endDate, start_time: hhmm(s), end_time: end ? endTime : null };
  };

  const inRange = row => row && row.date <= to && row.end_date >= from;

  const events = root.getAllSubcomponents('vevent').map(c => new ICAL.Event(c));
  const masters = new Map();
  const orphans = [];
  for (const ev of events) {
    if (!ev.isRecurrenceException()) masters.set(ev.uid || Symbol(), ev);
  }
  for (const ev of events) {
    if (!ev.isRecurrenceException()) continue;
    const master = masters.get(ev.uid);
    if (master) master.relateException(ev);
    else orphans.push(ev);
  }

  // Grenze für die Wiederholungs-Schleife (etwas Puffer wegen Zeitzonen)
  const [ty, tm, td] = addDaysISO(to, 2).split('-').map(Number);
  const stopAt = Date.UTC(ty, tm - 1, td);

  const rows = [];
  for (const ev of [...masters.values(), ...orphans]) {
    try {
      if (!ev.isRecurring() || ev.isRecurrenceException()) {
        const row = toRow(ev, ev.startDate, ev.endDate);
        if (inRange(row)) rows.push(row);
        continue;
      }
      const iterator = ev.iterator();
      const masterTz = tzParam(ev, 'dtstart');
      for (let i = 0, next; i < MAX_ITERATIONS && (next = iterator.next()); i++) {
        if (instantOf(next, masterTz) > stopAt) break;
        const details = ev.getOccurrenceDetails(next);
        const row = toRow(details.item, details.startDate, details.endDate);
        if (inRange(row)) rows.push(row);
      }
    } catch (err) {
      console.warn('Termin übersprungen:', ev.summary, err?.message);
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
}
