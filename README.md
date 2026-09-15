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

Dann http://localhost:5173 öffnen. Ohne Supabase-Daten läuft der **Demo-Modus** mit Beispieldaten. Diese liegen nur im Browser.

## 2. Supabase einrichten

1. Auf https://supabase.com ein kostenloses Projekt anlegen.
2. **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → *Run*.
   Das legt die Tabellen, die Zugriffsregeln, Realtime und den Storage-Bucket `avatars` für Profilbilder an.
3. **Authentication → Users → Add user**: Konten für dich und deine Frau anlegen, optional ein eigenes fürs Tablet.
   Die E-Mail muss nicht echt sein, wenn du „Auto Confirm User“ anhakst.
4. **Authentication → Sign In / Providers**: **„Allow new users to sign up“ ausschalten.**
   Sonst könnte sich jeder, der die Seite findet, ein Konto anlegen und eure Daten sehen.
5. **Project Settings → API**: *Project URL* und den *anon* bzw. *publishable* Key in [`js/config.js`](js/config.js) eintragen.

## 3. Kalender-Import einrichten (optional)

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

## 4. Online stellen

Die App muss über **HTTPS** erreichbar sein, damit Handys dazukommen und „Bildschirm anlassen“ funktioniert.
Am einfachsten geht das mit einem kostenlosen statischen Hosting:

- **GitHub Pages:** Repo pushen → Settings → Pages → Branch `main` / Root
- **Netlify / Vercel / Cloudflare Pages:** Ordner hochladen oder das Repo verbinden, ohne Build-Befehl

## 5. Geräte einrichten

- **Tablet:** Seite öffnen, anmelden, im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen und darüber starten (Vollbild).
  Unter Einstellungen „Bildschirm anlassen“ aktivieren. Das Tablet am besten dauerhaft am Strom lassen.
- **Handys:** Seite öffnen, mit dem eigenen Konto anmelden und ebenfalls zum Startbildschirm hinzufügen.

## Aufbau

```
index.html            Einstieg, Import-Map für die CDN-Module
css/style.css         Styles (hell/dunkel automatisch)
js/config.js          Supabase-Zugangsdaten
js/app.js             Oberfläche (Preact + htm)
js/data.js            Datenzugriff: Supabase oder lokaler Demo-Modus
js/dates.js           Datums-Helfer (Wochen beginnen Montag)
supabase/functions/   Edge Function für den Kalender-Import
supabase/schema.sql   Datenbank, Zugriffsregeln, Storage
```

## Ideen für später

- Sterne/Punkte für erledigte Aufgaben, Belohnungen für Kinder
- Einkaufsliste
- Essensplan pro Tag
- Push-Erinnerungen aufs Handy
