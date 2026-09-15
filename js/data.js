// Datenzugriff: Supabase oder lokaler Demo-Modus (gleiche Schnittstelle)
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { addDays, startOfWeek, toISO } from './dates.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

const MEMBER_FIELDS = ['id', 'name', 'color', 'avatar_url', 'sort_order'];
const TASK_FIELDS = ['id', 'title', 'member_id', 'date', 'repeat_days', 'end_date'];
const EVENT_FIELDS = ['id', 'title', 'date', 'start_time', 'end_time', 'member_ids', 'note', 'repeat_days', 'end_date'];
const CALENDAR_FIELDS = ['id', 'name', 'url', 'member_id'];

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
const withId = o => (o.id ? o : { ...o, id: uid() });

export const isRecurring = item => (item.repeat_days?.length ?? 0) > 0;

export function occursOn(item, iso, weekday) {
  if (!isRecurring(item)) return item.date === iso;
  if (iso < item.date) return false;
  if (item.end_date && iso > item.end_date) return false;
  return item.repeat_days.includes(weekday);
}

export async function createStore() {
  return SUPABASE_URL && SUPABASE_KEY ? createSupabaseStore() : createLocalStore();
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function createSupabaseStore() {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  const loadRange = async (table, from, to) => {
    const [single, recurring] = await Promise.all([
      sb.from(table).select('*').eq('recurring', false).gte('date', from).lte('date', to),
      sb.from(table).select('*').eq('recurring', true).lte('date', to).or(`end_date.is.null,end_date.gte.${from}`),
    ]);
    return [...check(single), ...check(recurring)];
  };

  return {
    mode: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },

    async load(from, to) {
      const [members, tasks, events, completions, calendars, calendarEvents] = await Promise.all([
        sb.from('members').select('*').order('sort_order').order('created_at').then(check),
        loadRange('tasks', from, to),
        loadRange('events', from, to),
        sb.from('task_completions').select('task_id,date').gte('date', from).lte('date', to).then(check),
        sb.from('calendars').select('*').order('created_at').then(check),
        sb.from('calendar_events').select('*').lte('date', to).gte('end_date', from).then(check),
      ]);
      return { members, tasks, events, completions, calendars, calendarEvents };
    },

    async saveCalendar(c) {
      check(await sb.from('calendars').upsert(pick(withId(c), CALENDAR_FIELDS)));
    },
    async deleteCalendar(id) {
      check(await sb.from('calendars').delete().eq('id', id));
    },
    async syncCalendars(calendarId) {
      const { data, error } = await sb.functions.invoke('sync-calendars', {
        body: calendarId ? { calendar_id: calendarId } : {},
      });
      if (error) {
        let message = error.message;
        try {
          message = (await error.context.json()).error || message;
        } catch {}
        throw new Error(`Kalender-Abgleich fehlgeschlagen: ${message}`);
      }
      return data;
    },

    async saveMember(m) {
      check(await sb.from('members').upsert(pick(withId(m), MEMBER_FIELDS)));
    },
    async deleteMember(id) {
      check(await sb.from('members').delete().eq('id', id));
    },
    async uploadAvatar(blob) {
      const path = `${uid()}.jpg`;
      check(await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' }));
      return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    },

    async saveTask(t) {
      check(await sb.from('tasks').upsert(pick(withId(t), TASK_FIELDS)));
    },
    async deleteTask(id) {
      check(await sb.from('tasks').delete().eq('id', id));
    },
    async setCompletion(taskId, date, done) {
      if (done) check(await sb.from('task_completions').upsert({ task_id: taskId, date }));
      else check(await sb.from('task_completions').delete().eq('task_id', taskId).eq('date', date));
    },

    async saveEvent(e) {
      check(await sb.from('events').upsert(pick(withId(e), EVENT_FIELDS)));
    },
    async deleteEvent(id) {
      check(await sb.from('events').delete().eq('id', id));
    },

    subscribe(cb) {
      const channel = sb.channel('familienplaner-changes');
      for (const table of ['members', 'tasks', 'events', 'task_completions', 'calendars']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => cb());
      }
      channel.subscribe();
      return () => sb.removeChannel(channel);
    },
  };
}

// ---------------------------------------------------------------------------
// Lokaler Demo-Modus (localStorage)
// ---------------------------------------------------------------------------

const LS_KEY = 'familienplaner-demo-v2';

function createLocalStore() {
  const listeners = new Set();
  const notify = () => listeners.forEach(l => l());

  const read = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return { calendars: [], calendarEvents: [], ...JSON.parse(raw) };
    } catch {}
    return seedDemo();
  };
  let db = read();

  const write = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
    } catch {}
    notify();
  };

  window.addEventListener('storage', e => {
    if (e.key === LS_KEY) {
      db = read();
      notify();
    }
  });

  const inRange = (from, to) => x =>
    isRecurring(x) ? x.date <= to && (!x.end_date || x.end_date >= from) : x.date >= from && x.date <= to;

  const upsert = (list, row) => {
    const i = list.findIndex(x => x.id === row.id);
    if (i >= 0) list[i] = { ...list[i], ...row };
    else list.push({ created_at: new Date().toISOString(), ...row });
  };

  return {
    mode: 'demo',

    async getSession() {
      return { demo: true };
    },
    onAuthChange() {
      return () => {};
    },
    async signIn() {},
    async signOut() {},

    async load(from, to) {
      return structuredClone({
        members: [...db.members].sort((a, b) => a.sort_order - b.sort_order),
        tasks: db.tasks.filter(inRange(from, to)),
        events: db.events.filter(inRange(from, to)),
        completions: db.completions.filter(c => c.date >= from && c.date <= to),
        calendars: db.calendars,
        calendarEvents: db.calendarEvents.filter(e => e.date <= to && e.end_date >= from),
      });
    },

    async saveCalendar(c) {
      upsert(db.calendars, pick(withId(c), CALENDAR_FIELDS));
      write();
    },
    async deleteCalendar(id) {
      db.calendars = db.calendars.filter(c => c.id !== id);
      db.calendarEvents = db.calendarEvents.filter(e => e.calendar_id !== id);
      write();
    },
    async syncCalendars() {
      throw new Error('Kalender-Import funktioniert nur mit Supabase (Demo-Modus).');
    },

    async saveMember(m) {
      upsert(db.members, pick(withId(m), MEMBER_FIELDS));
      write();
    },
    async deleteMember(id) {
      db.members = db.members.filter(m => m.id !== id);
      db.tasks.forEach(t => {
        if (t.member_id === id) t.member_id = null;
      });
      write();
    },
    async uploadAvatar(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    async saveTask(t) {
      upsert(db.tasks, pick(withId(t), TASK_FIELDS));
      write();
    },
    async deleteTask(id) {
      db.tasks = db.tasks.filter(t => t.id !== id);
      db.completions = db.completions.filter(c => c.task_id !== id);
      write();
    },
    async setCompletion(taskId, date, done) {
      db.completions = db.completions.filter(c => !(c.task_id === taskId && c.date === date));
      if (done) db.completions.push({ task_id: taskId, date });
      write();
    },

    async saveEvent(e) {
      upsert(db.events, pick(withId(e), EVENT_FIELDS));
      write();
    },
    async deleteEvent(id) {
      db.events = db.events.filter(e => e.id !== id);
      write();
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

function seedDemo() {
  const monday = startOfWeek(new Date());
  const day = n => toISO(addDays(monday, n));
  const now = new Date().toISOString();
  const [mama, papa, lena, tim] = [uid(), uid(), uid(), uid()];
  const [calMama, calFamily] = [uid(), uid()];
  const t = (title, member_id, date, repeat_days = []) => ({
    id: uid(), title, member_id, date, repeat_days, end_date: null, created_at: now,
  });
  const e = (title, member_ids, date, start_time, end_time = null, repeat_days = []) => ({
    id: uid(), title, member_ids, date, start_time, end_time, note: null, repeat_days, end_date: null, created_at: now,
  });

  return {
    members: [
      { id: mama, name: 'Mama', color: '#d66ba0', avatar_url: null, sort_order: 0 },
      { id: papa, name: 'Papa', color: '#4d96ff', avatar_url: null, sort_order: 1 },
      { id: lena, name: 'Lena', color: '#f4a259', avatar_url: null, sort_order: 2 },
      { id: tim, name: 'Tim', color: '#43aa8b', avatar_url: null, sort_order: 3 },
    ],
    tasks: [
      t('Geschirrspüler ausräumen', lena, day(0), [1, 3, 5]),
      t('Geschirrspüler ausräumen', tim, day(0), [2, 4, 6]),
      t('Zimmer aufräumen', lena, day(0), [6]),
      t('Zimmer aufräumen', tim, day(0), [6]),
      t('Tisch decken', null, day(0), [1, 2, 3, 4, 5, 6, 7]),
      t('Müll rausbringen', papa, day(3)),
      t('Wocheneinkauf', mama, day(4)),
    ],
    events: [
      e('Fußballtraining', [tim], day(1), '17:00', '18:30', [2, 4]),
      e('Zahnarzt', [lena, mama], day(2), '15:30'),
      e('Elternabend', [mama, papa], day(3), '19:30'),
      e('Oma kommt zu Besuch', [], day(6), null),
    ],
    completions: [],
    calendars: [
      { id: calMama, name: 'Mamas Kalender (Beispiel)', url: '', member_id: mama, last_synced_at: now, last_error: null, event_count: 1, created_at: now },
      { id: calFamily, name: 'Familienkalender (Beispiel)', url: '', member_id: null, last_synced_at: now, last_error: null, event_count: 1, created_at: now },
    ],
    calendarEvents: [
      { id: uid(), calendar_id: calMama, title: 'Friseur', location: 'Salon am Markt', date: day(1), end_date: day(1), start_time: '09:30', end_time: '10:30' },
      { id: uid(), calendar_id: calFamily, title: 'Herbstferien', location: null, date: day(4), end_date: day(6), start_time: null, end_time: null },
    ],
  };
}
