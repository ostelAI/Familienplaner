// Supabase-Zugangsdaten – dasselbe Projekt wie das Haushaltsbuch (gleiche Logins, gleicher Haushalt).
// Zu finden unter: Project Settings → API
//
// Der publishable/anon Key ist dafür gemacht, öffentlich im Browser zu stehen – er darf in ein
// öffentliches Repository. Geschützt werden die Daten durch die Zugriffsregeln in supabase/schema.sql:
// Ohne Anmeldung und ohne Mitgliedschaft im Haushalt sind alle Tabellen leer.
// Der service_role Key gehört NIEMALS hier hinein.
//
// Beide Felder leer lassen = lokaler Demo-Modus (Daten nur in diesem Browser).
export const SUPABASE_URL = 'https://hdmcflojfeoruhqbpppy.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_5UdjmwVF1kpIAc_r8N2RyQ_Nkvb-yde';
