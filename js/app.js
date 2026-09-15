import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html } from 'htm/preact';
import { createStore, isRecurring, occursOn, uid } from './data.js';
import * as D from './dates.js';

const COLORS = ['#ef6f6c', '#f4a259', '#e9c46a', '#5bb381', '#43aa8b', '#4d96ff', '#7b6cf6', '#d66ba0', '#8d6e63', '#64748b'];
const APP_VERSION = '1.0.0';
const SYNC_INTERVAL_MS =15 * 60 * 1000;
const TASK_SUGGESTIONS =['Zimmer aufräumen', 'Geschirrspüler ausräumen', 'Tisch decken', 'Müll rausbringen', 'Hausaufgaben', 'Blumen gießen'];

// ---------------------------------------------------------------------------
// Kleine Bausteine
// ---------------------------------------------------------------------------

const ICONS = {
  check: html`<path d="M5 12.5l4.5 4.5L19 7.5" />`,
  plus: html`<path d="M12 5v14M5 12h14" />`,
  left: html`<path d="M15 5l-7 7 7 7" />`,
  right: html`<path d="M9 5l7 7-7 7" />`,
  settings: html`<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" />`,
  repeat: html`<path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />`,
  more: html`<circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" />`,
  x: html`<path d="M6 6l12 12M18 6L6 18" />`,
  clock: html`<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />`,
  calendar: html`<rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" />`,
  pin: html`<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" />`,
  sync: html`<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" /><path d="M18 3v4h-4M6 21v-4h4" />`,
  camera: html`<path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />`,
};

const Icon = ({ name, size = 22 }) => html`
  <svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const initials = name => (name || '?').trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();

function Avatar({ member, size = 36 }) {
  const style = `--size:${size}px;--c:${member?.color || '#9aa3b2'}`;
  return html`<span class="avatar" style=${style}>
    ${member?.avatar_url ? html`<img src=${member.avatar_url} alt="" />` : member ? initials(member.name) : '★'}
  </span>`;
}

function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label=${title}>
        <div class="modal-head">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" onClick=${onClose} aria-label="Schließen"><${Icon} name="x" /></button>
        </div>
        <div class="modal-body">${children}</div>
        ${footer && html`<div class="modal-foot">${footer}</div>`}
      </div>
    </div>`;
}

function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useStoredFlag(key, initial = false) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return initial;
    }
  });
  const set = v => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {}
  };
  return [value, set];
}

// Hält den Bildschirm des Tablets an (nur über HTTPS verfügbar)
function useWakeLock(enabled) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {}
    };
    const onVisible = () => document.visibilityState === 'visible' && request();
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release();
    };
  }, [enabled]);
}

async function resizeImage(file, size = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas
      .getContext('2d')
      .drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Importierten Kalendertermin für einen bestimmten Tag aufbereiten (mehrtägige Termine!)
function calendarEventForDay(ev, iso, calendar) {
  const time = t => t?.slice(0, 5);
  const firstDay = ev.date === iso;
  const lastDay = ev.end_date === iso;
  let label;
  let start = null;
  if (!ev.start_time) label = 'Ganztägig';
  else if (firstDay && lastDay) label = ev.end_time ? `${time(ev.start_time)} – ${time(ev.end_time)}` : time(ev.start_time);
  else if (firstDay) label = `ab ${time(ev.start_time)}`;
  else if (lastDay && ev.end_time) label = `bis ${time(ev.end_time)}`;
  else label = 'Ganztägig';
  if (ev.start_time && firstDay) start = ev.start_time;

  return {
    ...ev,
    id: `cal-${ev.id}`,
    source: 'calendar',
    start_time: start,
    time_label: label,
    member_ids: calendar?.member_id ? [calendar.member_id] : [],
    calendar_name: calendar?.name || 'Kalender',
    original: ev,
  };
}

function formatSyncStatus(calendar) {
  if (calendar.last_error) return `Fehler: ${calendar.last_error}`;
  if (!calendar.last_synced_at) return 'Noch nicht abgeglichen';
  const when = new Date(calendar.last_synced_at).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const count = calendar.event_count ?? 0;
  return `${count} ${count === 1 ? 'Termin' : 'Termine'} · abgeglichen ${when}`;
}

// ---------------------------------------------------------------------------
// App / Login
// ---------------------------------------------------------------------------

function App({ store }) {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    store.getSession().then(setSession);
    return store.onAuthChange(setSession);
  }, [store]);

  // Haushalt aus dem Haushaltsbuch: nur Mitglieder dürfen in den Planer
  const [household, setHousehold] = useState(undefined);
  const [householdError, setHouseholdError] = useState(null);
  const userId = session?.user?.id ?? (session ? 'demo' : null);
  useEffect(() => {
    if (!userId) return;
    setHousehold(undefined);
    setHouseholdError(null);
    store.loadHousehold().then(setHousehold, err => setHouseholdError(err.message || String(err)));
  }, [store, userId]);

  if (session === undefined) return html`<div class="splash">Lade …</div>`;
  if (!session) return html`<${Login} store=${store} />`;
  if (householdError) return html`<${NoAccess} store=${store} message=${`Fehler beim Laden: ${householdError}`} />`;
  if (household === undefined) return html`<div class="splash">Lade …</div>`;
  if (!household) {
    return html`<${NoAccess} store=${store}
      message="Dieses Konto gehört zu keinem Haushalt. Der Familienplaner ist nur für Mitglieder eures Haushalts aus dem Haushaltsbuch zugänglich." />`;
  }
  return html`<${Planner} key=${household.id} store=${store} />`;
}

function NoAccess({ store, message }) {
  return html`
    <div class="login">
      <div class="login-card">
        <img src="icon.svg" alt="" width="64" height="64" />
        <h1>Kein Zugriff</h1>
        <p class="muted">${message}</p>
        <button class="btn block" onClick=${() => store.signOut()}>Abmelden</button>
      </div>
    </div>`;
}

function Login({ store }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.signIn(email.trim(), password);
    } catch (err) {
      const message = err.message || '';
      setError(
        /invalid login credentials/i.test(message)
          ? 'E-Mail oder Passwort ist falsch.'
          : /failed to fetch|network/i.test(message)
            ? 'Keine Verbindung. Bitte Internet prüfen.'
            : message || 'Anmeldung fehlgeschlagen'
      );
      setBusy(false);
    }
  };

  return html`
    <div class="login">
      <form class="login-card" onSubmit=${submit}>
        <img src="icon.svg" alt="" width="64" height="64" />
        <h1>Familienplaner</h1>
        <p class="muted small">Anmelden mit denselben Zugangsdaten wie im Haushaltsbuch.</p>
        <label class="field"><span>E-Mail</span>
          <input type="email" autocomplete="username" required value=${email} onInput=${e => setEmail(e.target.value)} />
        </label>
        <label class="field"><span>Passwort</span>
          <input type="password" autocomplete="current-password" required value=${password} onInput=${e => setPassword(e.target.value)} />
        </label>
        ${error && html`<p class="form-error">${error}</p>`}
        <button class="btn primary block" disabled=${busy}>${busy ? 'Anmelden …' : 'Anmelden'}</button>
      </form>
    </div>`;
}

// ---------------------------------------------------------------------------
// Wochenplaner
// ---------------------------------------------------------------------------

function Planner({ store }) {
  const now = useNow();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [wakeLock, setWakeLock] = useStoredFlag('familienplaner-wakelock');
  useWakeLock(wakeLock);

  const todayISO = D.toISO(now);
  const weekStart = D.addDays(D.startOfWeek(now), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(weekStart, i));
  const from = D.toISO(days[0]);
  const to = D.toISO(days[6]);

  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const result = await store.load(from, to);
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) setError(err.message || String(err));
    }
  }, [store, from, to]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    reload();
  }, [reload]);

  // Live-Updates + Fallback, falls das Tablet im Standby die Verbindung verliert
  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), 250);
    };
    const unsubscribe = store.subscribe(refresh);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);

  // Auf dem Handy direkt zum heutigen Tag scrollen
  const scrolled = useRef(false);
  useEffect(() => {
    if (!data || scrolled.current) return;
    scrolled.current = true;
    if (window.matchMedia('(max-width: 899px)').matches) {
      document.querySelector('.day.today')?.scrollIntoView({ block: 'start' });
    }
  }, [data]);

  const run = async fn => {
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.message || String(err));
      throw err;
    }
  };

  const doneSet = useMemo(() => new Set((data?.completions || []).map(c => `${c.task_id}|${c.date}`)), [data]);
  const membersById = useMemo(() => new Map((data?.members || []).map(m => [m.id, m])), [data]);

  const toggleTask = async (task, iso) => {
    const done = doneSet.has(`${task.id}|${iso}`);
    setData(d => ({
      ...d,
      completions: done
        ? d.completions.filter(c => !(c.task_id === task.id && c.date === iso))
        : [...d.completions, { task_id: task.id, date: iso }],
    }));
    try {
      await store.setCompletion(task.id, iso, !done);
    } catch (err) {
      setError(err.message || String(err));
      reload();
    }
  };

  // Kalender im Hintergrund abgleichen, wenn der letzte Import zu alt ist
  const lastSyncAttempt = useRef(0);
  useEffect(() => {
    if (!data || store.mode !== 'supabase' || !data.calendars.length) return;
    const stale = data.calendars.some(c => !c.last_synced_at || Date.now() - new Date(c.last_synced_at) > SYNC_INTERVAL_MS);
    if (!stale || Date.now() - lastSyncAttempt.current < SYNC_INTERVAL_MS) return;
    lastSyncAttempt.current = Date.now();
    store
      .syncCalendars()
      .then(() => reloadRef.current())
      .catch(err => console.warn(err));
  }, [data, store]);

  const calendarsById = useMemo(() => new Map((data?.calendars || []).map(c => [c.id, c])), [data]);

  const memberOrder = id => membersById.get(id)?.sort_order ?? 999;
  const byTaskOrder = (a, b) => memberOrder(a.member_id) - memberOrder(b.member_id) || (a.created_at || '').localeCompare(b.created_at || '');
  const byTime = (a, b) => (a.start_time || '').localeCompare(b.start_time || '');
  const matchesFilter = memberIds => !filter || !memberIds.length || memberIds.includes(filter);

  const columns = data
    ? days.map(date => {
        const iso = D.toISO(date);
        const wd = D.isoWeekday(date);
        const imported = data.calendarEvents
          .filter(e => e.date <= iso && e.end_date >= iso)
          .map(e => calendarEventForDay(e, iso, calendarsById.get(e.calendar_id)));
        return {
          date,
          iso,
          events: [...data.events.filter(e => occursOn(e, iso, wd)), ...imported]
            .filter(e => matchesFilter(e.member_ids))
            .sort(byTime),
          tasks: data.tasks
            .filter(t => occursOn(t, iso, wd) && (!filter || !t.member_id || t.member_id === filter))
            .sort(byTaskOrder),
        };
      })
    : [];

  const openNew = (iso = todayISO, kind = 'task') => setDialog({ type: 'item', kind, date: iso });

  const saveItem = (kind, row) => run(() => (kind === 'task' ? store.saveTask(row) : store.saveEvent(row)));
  const deleteItem = (kind, id) => run(() => (kind === 'task' ? store.deleteTask(id) : store.deleteEvent(id)));

  return html`
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <div class="clock">${D.fmtClock(now)}</div>
          <div class="today-label">${D.fmtLong(now)}</div>
        </div>

        <nav class="weeknav" aria-label="Woche wechseln">
          <button class="icon-btn" onClick=${() => setOffset(offset - 1)} aria-label="Vorige Woche"><${Icon} name="left" /></button>
          <button class="btn week-label ${offset === 0 ? '' : 'away'}" onClick=${() => setOffset(0)} title="Zur aktuellen Woche">
            <strong>KW ${D.isoWeek(weekStart)}</strong>
            <span>${D.fmtDayMonth(days[0])} – ${D.fmtDayMonth(days[6])}</span>
          </button>
          <button class="icon-btn" onClick=${() => setOffset(offset + 1)} aria-label="Nächste Woche"><${Icon} name="right" /></button>
        </nav>

        <div class="actions">
          <button class="icon-btn" onClick=${() => setDialog({ type: 'settings' })} aria-label="Einstellungen"><${Icon} name="settings" /></button>
          <button class="btn primary hide-narrow" onClick=${() => openNew()}><${Icon} name="plus" /> Neu</button>
        </div>
      </header>

      ${data &&
      html`<div class="memberbar" role="toolbar" aria-label="Nach Person filtern">
        <button class="chip ${filter ? '' : 'on'}" onClick=${() => setFilter(null)}>
          <${Avatar} size=${30} /> Alle
        </button>
        ${data.members.map(
          m => html`<button key=${m.id} class="chip ${filter === m.id ? 'on' : ''}" style="--c:${m.color}"
                            onClick=${() => setFilter(filter === m.id ? null : m.id)}>
            <${Avatar} member=${m} size=${30} /> ${m.name}
          </button>`
        )}
        ${store.mode === 'demo' && html`<span class="demo-badge" title="Supabase-Zugangsdaten in js/config.js eintragen">Demo-Modus · nur lokal</span>`}
      </div>`}

      ${!data && !error && html`<div class="splash">Lade Woche …</div>`}

      ${data &&
      html`<main class="week">
        ${columns.map(col => html`
          <${DayColumn} key=${col.iso} ...${col}
            isToday=${col.iso === todayISO}
            isPast=${col.iso < todayISO}
            doneSet=${doneSet}
            membersById=${membersById}
            onToggle=${task => toggleTask(task, col.iso)}
            onEditTask=${task => setDialog({ type: 'item', kind: 'task', item: task, date: col.iso })}
            onEditEvent=${event =>
              event.source === 'calendar'
                ? setDialog({ type: 'calendar-event', event })
                : setDialog({ type: 'item', kind: 'event', item: event, date: col.iso })}
            onAdd=${() => openNew(col.iso)} />`)}
      </main>`}

      <button class="fab" onClick=${() => openNew()} aria-label="Neu hinzufügen"><${Icon} name="plus" size=${28} /></button>

      ${error && html`<div class="toast" role="alert" onClick=${() => setError(null)}>⚠️ ${error}</div>`}

      ${dialog?.type === 'item' &&
      html`<${ItemDialog} key=${dialog.item?.id || 'new'} initial=${dialog} members=${data?.members || []}
            onSave=${saveItem} onDelete=${deleteItem} onClose=${() => setDialog(null)} />`}

      ${dialog?.type === 'settings' &&
      html`<${SettingsDialog} store=${store} members=${data?.members || []} calendars=${data?.calendars || []}
            wakeLock=${wakeLock} setWakeLock=${setWakeLock}
            onSaveMember=${m => run(() => store.saveMember(m))}
            onDeleteMember=${id => run(() => store.deleteMember(id))}
            onSaveCalendar=${c => run(() => store.saveCalendar(c))}
            onDeleteCalendar=${id => run(() => store.deleteCalendar(id))}
            onSyncCalendars=${async id => { await store.syncCalendars(id); await reload(); }}
            onClose=${() => setDialog(null)} />`}

      ${dialog?.type === 'calendar-event' &&
      html`<${CalendarEventDialog} event=${dialog.event} membersById=${membersById} onClose=${() => setDialog(null)} />`}
    </div>`;
}

function DayColumn({ date, iso, events, tasks, isToday, isPast, doneSet, membersById, onToggle, onEditTask, onEditEvent, onAdd }) {
  const doneCount = tasks.filter(t => doneSet.has(`${t.id}|${iso}`)).length;
  const allDone = tasks.length > 0 && doneCount === tasks.length;

  return html`
    <section class="day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}" aria-label=${D.fmtLong(date)}>
      <header class="day-head">
        <div>
          <div class="day-name">${D.WEEKDAYS_LONG[D.isoWeekday(date) - 1]}</div>
          <div class="day-date">${D.fmtDayMonth(date)}${isToday ? ' · Heute' : ''}</div>
        </div>
        ${tasks.length > 0 && html`<div class="day-count ${allDone ? 'all-done' : ''}">${allDone ? '🎉' : `${doneCount}/${tasks.length}`}</div>`}
      </header>
      ${tasks.length > 0 && html`<div class="progress"><i style="width:${(doneCount / tasks.length) * 100}%"></i></div>`}

      <div class="day-body">
        ${events.map(ev => {
          const people = ev.member_ids.map(id => membersById.get(id)).filter(Boolean);
          const fromCalendar = ev.source === 'calendar';
          return html`<button key=${ev.id} class="event ${fromCalendar ? 'imported' : ''}" style="--c:${people[0]?.color || 'var(--accent)'}" onClick=${() => onEditEvent(ev)}>
            <span class="event-time">
              ${fromCalendar ? ev.time_label : ev.start_time ? `${ev.start_time.slice(0, 5)}${ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''}` : 'Ganztägig'}
              ${isRecurring(ev) && html`<${Icon} name="repeat" size=${12} />`}
              ${fromCalendar && html`<span class="event-source" title=${ev.calendar_name}><${Icon} name="calendar" size=${12} /></span>`}
            </span>
            <span class="event-title">${ev.title}</span>
            ${people.length > 0 && html`<span class="event-people">${people.map(p => html`<${Avatar} key=${p.id} member=${p} size=${22} />`)}</span>`}
          </button>`;
        })}

        ${tasks.map(task => {
          const member = membersById.get(task.member_id);
          const done = doneSet.has(`${task.id}|${iso}`);
          return html`<div key=${task.id} class="task ${done ? 'done' : ''}" style="--c:${member?.color || '#9aa3b2'}"
                           role="checkbox" aria-checked=${done} tabindex="0"
                           onClick=${() => onToggle(task)}
                           onKeyDown=${e => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onToggle(task))}>
            <span class="task-check">
              <${Avatar} member=${member} size=${30} />
              <span class="task-tick"><${Icon} name="check" size=${18} /></span>
            </span>
            <span class="task-text">
              <span class="task-title">${task.title}</span>
              <span class="task-meta">
                <span>${member?.name || 'Alle'}</span>
                ${isRecurring(task) && html`<${Icon} name="repeat" size=${11} />`}
                <button class="task-edit" aria-label="Bearbeiten" onClick=${e => (e.stopPropagation(), onEditTask(task))}>
                  <${Icon} name="more" size=${18} />
                </button>
              </span>
            </span>
          </div>`;
        })}

        ${!events.length && !tasks.length && html`<div class="day-empty">Nichts geplant</div>`}
      </div>

      <button class="day-add" onClick=${onAdd} aria-label="Eintrag hinzufügen"><${Icon} name="plus" size=${18} /></button>
    </section>`;
}

// ---------------------------------------------------------------------------
// Aufgabe / Termin bearbeiten
// ---------------------------------------------------------------------------

function ItemDialog({ initial, members, onSave, onDelete, onClose }) {
  const src = initial.item || {};
  const editing = !!initial.item;
  const [kind, setKind] = useState(initial.kind);
  const [title, setTitle] = useState(src.title || '');
  const [date, setDate] = useState(src.date || initial.date);
  const [repeat, setRepeat] = useState(src.repeat_days || []);
  const [people, setPeople] = useState(src.member_ids || (src.member_id ? [src.member_id] : []));
  const [start, setStart] = useState(src.start_time?.slice(0, 5) || '');
  const [end, setEnd] = useState(src.end_time?.slice(0, 5) || '');
  const [note, setNote] = useState(src.note || '');
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => {
    if (!editing) titleRef.current?.focus();
  }, []);

  const isTask = kind === 'task';
  const recurring = repeat.length > 0;

  const togglePerson = id => {
    if (isTask) setPeople(people[0] === id ? [] : [id]);
    else setPeople(people.includes(id) ? people.filter(p => p !== id) : [...people, id]);
  };
  const toggleDay = n => setRepeat(repeat.includes(n) ? repeat.filter(d => d !== n) : [...repeat, n].sort((a, b) => a - b));

  const guard = async fn => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const submit = e => {
    e.preventDefault();
    if (!title.trim()) return;
    const base = { id: src.id, title: title.trim(), date, repeat_days: repeat, end_date: src.end_date ?? null };
    const row = isTask
      ? { ...base, member_id: people[0] ?? null }
      : { ...base, member_ids: people, start_time: start || null, end_time: start && end ? end : null, note: note.trim() || null };
    guard(() => onSave(kind, row));
  };

  const remove = () => {
    const msg = isRecurring(src) ? `„${src.title}“ an allen Tagen löschen?` : `„${src.title}“ löschen?`;
    if (confirm(msg)) guard(() => onDelete(kind, src.id));
  };

  // Wiederkehrenden Eintrag ab dem angeklickten Tag beenden
  const endHere = () => {
    const endDate = D.toISO(D.addDays(D.fromISO(initial.date), -1));
    if (endDate < src.date) return remove();
    if (confirm(`„${src.title}“ ab ${D.fmtDayMonth(D.fromISO(initial.date))} nicht mehr anzeigen?`)) {
      guard(() => onSave(kind, { ...src, end_date: endDate }));
    }
  };

  const footer = html`
    ${editing && html`<button type="button" class="btn danger" disabled=${busy} onClick=${remove}>Löschen</button>`}
    ${editing && isRecurring(src) && html`<button type="button" class="btn" disabled=${busy} onClick=${endHere}>Ab hier beenden</button>`}
    <span class="spacer"></span>
    <button type="button" class="btn" onClick=${onClose}>Abbrechen</button>
    <button type="submit" form="item-form" class="btn primary" disabled=${busy || !title.trim()}>Speichern</button>`;

  return html`
    <${Modal} title=${editing ? (isTask ? 'Aufgabe bearbeiten' : 'Termin bearbeiten') : 'Neuer Eintrag'} onClose=${onClose} footer=${footer}>
      <form id="item-form" onSubmit=${submit}>
        ${!editing && html`<div class="seg big">
          <button type="button" class=${isTask ? 'on' : ''} onClick=${() => { setKind('task'); setPeople(people.slice(0, 1)); }}>✅ Aufgabe</button>
          <button type="button" class=${!isTask ? 'on' : ''} onClick=${() => setKind('event')}>📅 Termin</button>
        </div>`}

        <label class="field"><span>Titel</span>
          <input value=${title} onInput=${e => setTitle(e.target.value)} placeholder=${isTask ? 'z. B. Zimmer aufräumen' : 'z. B. Zahnarzt'} ref=${titleRef} required />
        </label>

        ${isTask && !editing && html`<div class="suggestions">
          ${TASK_SUGGESTIONS.map(s => html`<button type="button" class="suggestion" onClick=${() => setTitle(s)}>${s}</button>`)}
        </div>`}

        <div class="field"><span>${isTask ? 'Für wen?' : 'Wer ist dabei?'}</span>
          <div class="people">
            <button type="button" class="person ${people.length === 0 ? 'on' : ''}" onClick=${() => setPeople([])}>
              <${Avatar} size=${44} /><span>Alle</span>
            </button>
            ${members.map(m => html`<button type="button" key=${m.id} class="person ${people.includes(m.id) ? 'on' : ''}" style="--c:${m.color}" onClick=${() => togglePerson(m.id)}>
              <${Avatar} member=${m} size=${44} /><span>${m.name}</span>
            </button>`)}
          </div>
        </div>

        <div class="row">
          <label class="field"><span>${recurring ? 'Ab Datum' : 'Datum'}</span>
            <input type="date" value=${date} onInput=${e => e.target.value && setDate(e.target.value)} required />
          </label>
          ${!isTask && html`
            <label class="field"><span>Von (optional)</span>
              <input type="time" value=${start} onInput=${e => setStart(e.target.value)} />
            </label>
            <label class="field"><span>Bis</span>
              <input type="time" value=${end} disabled=${!start} onInput=${e => setEnd(e.target.value)} />
            </label>`}
        </div>

        <div class="field"><span>Wiederholen</span>
          <div class="repeat">
            <div class="seg">
              <button type="button" class=${!recurring ? 'on' : ''} onClick=${() => setRepeat([])}>Einmalig</button>
              <button type="button" class=${repeat.length === 7 ? 'on' : ''} onClick=${() => setRepeat([1, 2, 3, 4, 5, 6, 7])}>Täglich</button>
              <button type="button" class=${repeat.join() === '1,2,3,4,5' ? 'on' : ''} onClick=${() => setRepeat([1, 2, 3, 4, 5])}>Mo–Fr</button>
            </div>
            <div class="weekdays">
              ${D.WEEKDAYS_SHORT.map((label, i) => html`<button type="button" class=${repeat.includes(i + 1) ? 'on' : ''} onClick=${() => toggleDay(i + 1)}>${label}</button>`)}
            </div>
          </div>
        </div>

        ${!isTask && html`<label class="field"><span>Notiz</span>
          <textarea rows="2" value=${note} onInput=${e => setNote(e.target.value)} placeholder="z. B. Versichertenkarte mitnehmen"></textarea>
        </label>`}
      </form>
    <//>`;
}

// ---------------------------------------------------------------------------
// Einstellungen & Familienmitglieder
// ---------------------------------------------------------------------------

function SettingsDialog({
  store, members, calendars, wakeLock, setWakeLock,
  onSaveMember, onDeleteMember, onSaveCalendar, onDeleteCalendar, onSyncCalendars, onClose,
}) {
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  if (editing?.member !== undefined) {
    return html`<${MemberForm} store=${store} member=${editing.member} sortOrder=${members.length}
      onSave=${async m => { await onSaveMember(m); setEditing(null); }}
      onDelete=${async id => { await onDeleteMember(id); setEditing(null); }}
      onBack=${() => setEditing(null)} />`;
  }

  if (editing?.calendar !== undefined) {
    return html`<${CalendarForm} store=${store} calendar=${editing.calendar} members=${members}
      onSave=${async c => {
        await onSaveCalendar(c);
        setEditing(null);
        if (store.mode === 'supabase') syncNow(c.id);
      }}
      onDelete=${async id => { await onDeleteCalendar(id); setEditing(null); }}
      onBack=${() => setEditing(null)} />`;
  }

  async function syncNow(calendarId) {
    setSyncing(true);
    setSyncError(null);
    try {
      await onSyncCalendars(calendarId);
    } catch (err) {
      setSyncError(err.message || String(err));
    } finally {
      setSyncing(false);
    }
  }

  const membersById = new Map(members.map(m => [m.id, m]));
  const calendarSection = html`
    <h3>Kalender</h3>
    <p class="muted small">Termine aus Google- oder iCloud-Kalendern werden automatisch angezeigt (alle 15 Minuten).</p>
    <div class="member-list">
      ${calendars.map(c => html`<button key=${c.id} class="member-row" onClick=${() => setEditing({ calendar: c })}>
        ${c.member_id && membersById.get(c.member_id)
          ? html`<${Avatar} member=${membersById.get(c.member_id)} size=${44} />`
          : html`<span class="avatar add-avatar" style="--size:44px"><${Icon} name="calendar" /></span>`}
        <span class="row-text">${c.name}<small class=${c.last_error ? 'error-text' : ''}>${formatSyncStatus(c)}</small></span>
        <${Icon} name="right" size=${18} />
      </button>`)}
      <button class="member-row add" onClick=${() => setEditing({ calendar: null })}>
        <span class="avatar add-avatar" style="--size:44px"><${Icon} name="plus" /></span><span>Kalender verbinden</span>
      </button>
    </div>
    ${calendars.length > 0 && store.mode === 'supabase' && html`
      <button class="btn block" disabled=${syncing} onClick=${() => syncNow()}>
        <${Icon} name="sync" size=${18} /> ${syncing ? 'Gleiche ab …' : 'Jetzt abgleichen'}
      </button>`}
    ${syncError && html`<p class="form-error">${syncError}</p>`}`;

  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();

  return html`
    <${Modal} title="Einstellungen" onClose=${onClose}>
      <h3>Familie</h3>
      <div class="member-list">
        ${members.map(m => html`<button key=${m.id} class="member-row" onClick=${() => setEditing({ member: m })}>
          <${Avatar} member=${m} size=${44} /><span>${m.name}</span><${Icon} name="right" size=${18} />
        </button>`)}
        <button class="member-row add" onClick=${() => setEditing({ member: null })}>
          <span class="avatar add-avatar" style="--size:44px"><${Icon} name="plus" /></span><span>Person hinzufügen</span>
        </button>
      </div>

      ${calendarSection}

      <h3>Tablet</h3>
      <label class="switch-row">
        <span>Bildschirm anlassen<small>Verhindert, dass das Tablet in den Standby geht (nur über HTTPS)</small></span>
        <input type="checkbox" checked=${wakeLock} onChange=${e => setWakeLock(e.target.checked)} />
      </label>
      <button class="btn block" onClick=${toggleFullscreen}>Vollbild umschalten</button>

      <h3>Konto</h3>
      ${store.mode === 'demo'
        ? html`<p class="muted">Demo-Modus: Die Daten liegen nur in diesem Browser. Trage deine Supabase-Daten in <code>js/config.js</code> ein, um Tablet und Handys zu verbinden.</p>`
        : html`<button class="btn danger block" onClick=${() => confirm('Wirklich abmelden?') && store.signOut()}>Abmelden</button>`}
      <p class="muted small version">Familienplaner ${APP_VERSION}</p>
    <//>`;
}

function CalendarForm({ store, calendar, members, onSave, onDelete, onBack }) {
  const [name, setName] = useState(calendar?.name || '');
  const [url, setUrl] = useState(calendar?.url || '');
  const [memberId, setMemberId] = useState(calendar?.member_id ?? null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(calendar ? null : 'google');

  const validUrl = /^(https?|webcals?):\/\/\S+$/i.test(url.trim());

  const guard = async fn => {
    setBusy(true);
    try {
      await fn();
    } catch {
      setBusy(false);
    }
  };

  const submit = e => {
    e.preventDefault();
    if (!name.trim() || !validUrl) return;
    guard(() => onSave({ id: calendar?.id || uid(), name: name.trim(), url: url.trim(), member_id: memberId }));
  };

  const remove = () => {
    if (confirm(`Kalender „${calendar.name}“ trennen? Die importierten Termine verschwinden aus dem Planer.`)) guard(() => onDelete(calendar.id));
  };

  const footer = html`
    ${calendar && html`<button type="button" class="btn danger" disabled=${busy} onClick=${remove}>Trennen</button>`}
    <span class="spacer"></span>
    <button type="button" class="btn" onClick=${onBack}>Zurück</button>
    <button type="submit" form="calendar-form" class="btn primary" disabled=${busy || !name.trim() || !validUrl}>Speichern</button>`;

  return html`
    <${Modal} title=${calendar ? 'Kalender bearbeiten' : 'Kalender verbinden'} onClose=${onBack} footer=${footer}>
      <form id="calendar-form" onSubmit=${submit}>
        ${store.mode === 'demo' && html`<p class="notice">Im Demo-Modus wird der Kalender nur gespeichert, aber nicht abgerufen. Dafür braucht es Supabase.</p>`}

        <label class="field"><span>Name</span>
          <input value=${name} onInput=${e => setName(e.target.value)} placeholder="z. B. Papas Kalender" required />
        </label>

        <label class="field"><span>iCal-Link</span>
          <input type="url" inputmode="url" value=${url} onInput=${e => setUrl(e.target.value)}
                 placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off" spellcheck="false" required />
        </label>

        <div class="field"><span>Wem gehören die Termine?</span>
          <div class="people">
            <button type="button" class="person ${!memberId ? 'on' : ''}" onClick=${() => setMemberId(null)}>
              <${Avatar} size=${44} /><span>Alle</span>
            </button>
            ${members.map(m => html`<button type="button" key=${m.id} class="person ${memberId === m.id ? 'on' : ''}" style="--c:${m.color}" onClick=${() => setMemberId(m.id)}>
              <${Avatar} member=${m} size=${44} /><span>${m.name}</span>
            </button>`)}
          </div>
        </div>

        <div class="field"><span>Wo finde ich den Link?</span>
          <div class="seg">
            <button type="button" class=${help === 'google' ? 'on' : ''} onClick=${() => setHelp(help === 'google' ? null : 'google')}>Google</button>
            <button type="button" class=${help === 'icloud' ? 'on' : ''} onClick=${() => setHelp(help === 'icloud' ? null : 'icloud')}>iCloud / iPhone</button>
          </div>
          ${help === 'google' && html`<ol class="help">
            <li>Google Kalender <strong>am Computer</strong> im Browser öffnen (calendar.google.com).</li>
            <li>Links bei „Meine Kalender“ auf die drei Punkte neben dem Kalender → <strong>Einstellungen und Freigabe</strong>.</li>
            <li>Ganz unten bei „Kalender integrieren“ die <strong>Privatadresse im iCal-Format</strong> kopieren.</li>
          </ol>`}
          ${help === 'icloud' && html`<ol class="help">
            <li>Auf dem iPhone die <strong>Kalender-App</strong> öffnen → unten auf <strong>Kalender</strong> tippen.</li>
            <li>Beim gewünschten Kalender auf <strong>ⓘ</strong> tippen → <strong>Öffentlicher Kalender</strong> einschalten.</li>
            <li><strong>Link teilen</strong> → Kopieren und hier einfügen (beginnt mit <code>webcal://</code>).</li>
          </ol>
          <p class="muted small">Hinweis: Wer den öffentlichen Link kennt, kann den Kalender lesen. Den Link also nicht weitergeben.</p>`}
        </div>
      </form>
    <//>`;
}

function CalendarEventDialog({ event, membersById, onClose }) {
  const ev = event.original;
  const start = D.fromISO(ev.date);
  const end = D.fromISO(ev.end_date);
  const sameDay = ev.date === ev.end_date;
  const time = t => t?.slice(0, 5);
  const member = membersById.get(event.member_ids[0]);

  let when;
  if (!ev.start_time) when = sameDay ? `${D.fmtLong(start)} · ganztägig` : `${D.fmtLong(start)} – ${D.fmtLong(end)}`;
  else if (sameDay) when = `${D.fmtLong(start)} · ${time(ev.start_time)}${ev.end_time ? ` – ${time(ev.end_time)}` : ''} Uhr`;
  else when = `${D.fmtLong(start)}, ${time(ev.start_time)} Uhr – ${D.fmtLong(end)}${ev.end_time ? `, ${time(ev.end_time)} Uhr` : ''}`;

  return html`
    <${Modal} title=${ev.title} onClose=${onClose} footer=${html`<span class="spacer"></span><button class="btn primary" onClick=${onClose}>OK</button>`}>
      <div class="detail-list">
        <div class="detail"><${Icon} name="clock" size=${18} /><span>${when}</span></div>
        ${ev.location && html`<div class="detail"><${Icon} name="pin" size=${18} /><span>${ev.location}</span></div>`}
        <div class="detail"><${Icon} name="calendar" size=${18} /><span>${event.calendar_name}</span></div>
        ${member && html`<div class="detail"><${Avatar} member=${member} size=${22} /><span>${member.name}</span></div>`}
      </div>
      <p class="muted small">Dieser Termin kommt aus eurem Kalender. Ändern oder löschen könnt ihr ihn dort, der Planer übernimmt das beim nächsten Abgleich.</p>
    <//>`;
}

function MemberForm({ store, member, sortOrder, onSave, onDelete, onBack }) {
  const [name, setName] = useState(member?.name || '');
  const [color, setColor] = useState(member?.color || COLORS[sortOrder % COLORS.length]);
  // { path, url } – path wird gespeichert, url dient der Vorschau
  const [avatar, setAvatar] = useState(member?.avatar_path ? { path: member.avatar_path, url: member.avatar_url } : null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  useEffect(() => {
    if (!member) nameRef.current?.focus();
  }, []);

  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setAvatar(await store.uploadAvatar(await resizeImage(file)));
    } catch (err) {
      setError(`Bild konnte nicht hochgeladen werden: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const guard = async fn => {
    setBusy(true);
    try {
      await fn();
    } catch {
      setBusy(false);
    }
  };

  const submit = e => {
    e.preventDefault();
    if (!name.trim()) return;
    guard(() => onSave({ id: member?.id, name: name.trim(), color, avatar_path: avatar?.path ?? null, sort_order: member?.sort_order ?? sortOrder }));
  };

  const remove = () => {
    if (confirm(`${member.name} entfernen? Aufgaben bleiben erhalten und gelten dann für alle.`)) guard(() => onDelete(member.id));
  };

  const preview = { name: name || '?', color, avatar_url: avatar?.url };

  const footer = html`
    ${member && html`<button type="button" class="btn danger" disabled=${busy} onClick=${remove}>Entfernen</button>`}
    <span class="spacer"></span>
    <button type="button" class="btn" onClick=${onBack}>Zurück</button>
    <button type="submit" form="member-form" class="btn primary" disabled=${busy || uploading || !name.trim()}>Speichern</button>`;

  return html`
    <${Modal} title=${member ? 'Person bearbeiten' : 'Person hinzufügen'} onClose=${onBack} footer=${footer}>
      <form id="member-form" onSubmit=${submit}>
        <div class="avatar-edit">
          <label class="avatar-upload">
            <${Avatar} member=${preview} size=${112} />
            <span class="avatar-upload-badge">${uploading ? '…' : html`<${Icon} name="camera" size=${20} />`}</span>
            <input type="file" accept="image/*" onChange=${pickFile} hidden />
          </label>
          ${avatar && html`<button type="button" class="btn small" onClick=${() => setAvatar(null)}>Bild entfernen</button>`}
        </div>
        ${error && html`<p class="form-error">${error}</p>`}

        <label class="field"><span>Name</span>
          <input value=${name} onInput=${e => setName(e.target.value)} placeholder="z. B. Lena" ref=${nameRef} required />
        </label>

        <div class="field"><span>Farbe</span>
          <div class="swatches">
            ${COLORS.map(c => html`<button type="button" key=${c} class="swatch ${c === color ? 'on' : ''}" style="--c:${c}" aria-label=${`Farbe ${c}`} onClick=${() => setColor(c)}></button>`)}
          </div>
        </div>
      </form>
    <//>`;
}

// ---------------------------------------------------------------------------

createStore()
  .then(store => render(html`<${App} store=${store} />`, document.getElementById('app')))
  .catch(err => {
    const el = document.createElement('div');
    el.className = 'splash';
    el.textContent = `Fehler beim Start: ${err.message}`;
    document.getElementById('app').replaceChildren(el);
  });
