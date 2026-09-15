// Supabase Edge Function: holt alle eingetragenen iCal-Kalender ab und speichert die Termine
// in "calendar_events". Wird von der App aufgerufen (angemeldeter Nutzer, Row Level Security greift).
import ICAL from 'npm:ical.js@2.1.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { expandCalendar } from './ical-expand.js';

const TIME_ZONE = Deno.env.get('PLANNER_TIME_ZONE') ?? 'Europe/Berlin';
const PAST_DAYS = 31;
const FUTURE_DAYS = 400;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const dateInZone = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(Date.now() + offsetDays * 86400000));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: auth } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!auth?.user) return json({ error: 'Nicht angemeldet' }, 401);

  let body: { calendar_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // kein Body → alle Kalender
  }

  let query = sb.from('planner_calendars').select('*');
  if (body.calendar_id) query = query.eq('id', body.calendar_id);
  const { data: calendars, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const from = dateInZone(-PAST_DAYS);
  const to = dateInZone(FUTURE_DAYS);
  const results = [];
  for (const calendar of calendars ?? []) {
    results.push(await syncCalendar(sb, calendar, from, to));
  }
  return json({ results });
});

async function syncCalendar(sb: SupabaseClient, calendar: { id: string; url: string; household_id: string }, from: string, to: string) {
  try {
    const url = calendar.url.trim().replace(/^webcals?:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(url)) throw new Error('Ungültiger Link – er muss mit https:// oder webcal:// beginnen');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Familienplaner/1.0', Accept: 'text/calendar, */*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Kalender antwortet mit Fehler ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Der Link liefert keinen iCal-Kalender');

    const rows = expandCalendar(ICAL, text, { from, to, timeZone: TIME_ZONE }).map(row => ({
      ...row,
      calendar_id: calendar.id,
      household_id: calendar.household_id,
    }));

    const del = await sb.from('planner_calendar_events').delete().eq('calendar_id', calendar.id);
    if (del.error) throw del.error;
    for (let i = 0; i < rows.length; i += 500) {
      const ins = await sb.from('planner_calendar_events').insert(rows.slice(i, i + 500));
      if (ins.error) throw ins.error;
    }

    await sb
      .from('planner_calendars')
      .update({ last_synced_at: new Date().toISOString(), last_error: null, event_count: rows.length })
      .eq('id', calendar.id);
    return { id: calendar.id, count: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.from('planner_calendars').update({ last_synced_at: new Date().toISOString(), last_error: message }).eq('id', calendar.id);
    return { id: calendar.id, error: message };
  }
}
