# Familienplaner

Wochenplaner für die Familie: Montag bis Sonntag nebeneinander, Aufgaben zum Abhaken, Termine und Familienmitglieder mit Foto.
Gedacht für ein Tablet in der Küche. Einträge kommen auch vom Handy. Änderungen erscheinen per Supabase Realtime sofort auf allen Geräten.

- **Tablet (quer):** 7 Tagesspalten, großes Antippen zum Abhaken, Uhr und Datum, Bildschirm-anlassen-Option
- **Handy:** Tage untereinander, springt automatisch zu heute, „+“-Knopf unten rechts
- **Aufgaben:** einmalig oder wiederkehrend (täglich, Mo–Fr, beliebige Wochentage), einer Person oder allen zugeordnet
- **Termine:** mit oder ohne Uhrzeit, mehrere Personen, Notiz, auch wiederkehrend (z. B. Training jeden Di/Do)
- **Kalender-Import:** Termine aus Google- und iCloud-Kalendern erscheinen automatisch (Abgleich alle 15 Minuten, nur lesend)
- **Filter:** Tippt man oben auf eine Person, sieht man nur deren Einträge und die für alle

Kein Build-Schritt nötig: Das ist reines HTML/JS. Preact und supabase-js werden per CDN geladen.

## 1. Lokal ausprobieren

```bash
python -m http.server 5173
```

Dann http://localhost:5173 öffnen. Leert man die beiden Felder in [`js/config.js`](js/config.js), läuft ein **Demo-Modus** mit Beispieldaten, die nur im Browser liegen.

## 2. Zugriff: nur euer Haushalt

Der Familienplaner nutzt **dasselbe Supabase-Projekt wie das Haushaltsbuch**.

- **Anmeldung** mit denselben Konten (E-Mail und Passwort) wie im Haushaltsbuch
- **Zugriff** hat nur, wer **Mitglied eures Haushalts** ist. Auch wer sich ein eigenes Konto anlegt, sieht nichts und landet auf „Kein Zugriff“.
- **Zugriffsregeln** (Row Level Security) schützen alle Tabellen: Ohne Anmeldung und Haushalts-Mitgliedschaft sind sie leer.
- **Profilbilder** liegen in einem **privaten** Speicher und sind nur mit Anmeldung abrufbar.
- **Der Code ist öffentlich**, die Daten sind es nicht. Der Key in `config.js` ist der öffentliche *publishable* Key, wie im Haushaltsbuch.

Ein Tablet in der Küche meldet ihr mit einem eurer beiden Konten an. Die Sitzung bleibt dauerhaft bestehen.

## 3. Datenbank einrichten (einmalig)

Im Supabase-Projekt des Haushaltsbuchs: **SQL Editor → New query** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.

Das legt die Tabellen `planner_*`, die Zugriffsregeln, Live-Updates und den privaten Bucket `planner-avatars` an.
Die Tabellen des Haushaltsbuchs bleiben unangetastet. Das Skript ist wiederholbar.

## 4. Kalender-Import einrichten (optional)

Die Kalender werden von einer **Supabase Edge Function** abgeholt, weil Google und iCloud den direkten Abruf aus dem Browser nicht erlauben.

1. Im Supabase-Dashboard **Edge Functions → Deploy a new function → Via Editor** wählen.
2. Als Namen genau `sync-calendars` eintragen.
3. Die beiden Dateien aus [`supabase/functions/sync-calendars/`](supabase/functions/sync-calendars/) anlegen:
   `index.ts` und `ical-expand.js`. Inhalte einfügen und *Deploy* klicken.
4. In der App unter **Einstellungen → Kalender verbinden** den iCal-Link einfügen und eine Person zuordnen.
   Eine Anleitung, wo man den Link bei Google und iCloud findet, ist direkt im Formular.

Sobald ein Gerät (z. B. das Tablet) den Planer offen hat, gleicht es die Kalender automatisch ab, wenn der letzte Abgleich älter als 15 Minuten ist.
Importiert werden Termine von 1 Monat zurück bis gut 1 Jahr voraus. Die Zeitzone ist `Europe/Berlin` und lässt sich über das Secret `PLANNER_TIME_ZONE` ändern.

Mit installierter Supabase CLI geht das Deployen alternativ so: `supabase functions deploy sync-calendars`.

## 5. Online stellen

Die App muss über **HTTPS** erreichbar sein, damit Handys dazukommen und „Bildschirm anlassen“ funktioniert.
Am einfachsten geht das mit einem kostenlosen statischen Hosting:

- **GitHub Pages** (wie beim Haushaltsbuch): Settings → Pages → *Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
  Die Seite läuft dann unter `https://ostelai.github.io/Familienplaner/`.
- **Netlify / Vercel / Cloudflare Pages:** Ordner hochladen oder das Repo verbinden, ohne Build-Befehl

## 6. Geräte einrichten

- **Tablet:** Seite öffnen, anmelden, im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen und darüber starten (Vollbild).
  Unter Einstellungen „Bildschirm anlassen“ aktivieren. Das Tablet am besten dauerhaft am Strom lassen.
- **Handys:** Seite öffnen, mit dem eigenen Konto anmelden und ebenfalls zum Startbildschirm hinzufügen.

## Aufbau

```
index.html            Einstieg, Import-Map für die CDN-Module
css/style.css         Styles (hell/dunkel automatisch)
js/config.js          Supabase-Zugangsdaten (Projekt des Haushaltsbuchs)
js/app.js             Oberfläche (Preact + htm)
js/data.js            Datenzugriff: Supabase oder lokaler Demo-Modus
js/dates.js           Datums-Helfer (Wochen beginnen Montag)
supabase/functions/   Edge Function für den Kalender-Import
supabase/schema.sql   Tabellen, Zugriffsregeln, privater Bild-Speicher
```

## Ideen für später

- Sterne/Punkte für erledigte Aufgaben, Belohnungen für Kinder
- Einkaufsliste
- Essensplan pro Tag
- Push-Erinnerungen aufs Handy
