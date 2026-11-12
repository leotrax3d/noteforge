# Releases & Auto-Update

Noteforge aktualisiert sich über den Tauri-Updater aus GitHub-Releases. Die Updates sind signiert. Die App installiert nur Pakete, deren Signatur zum öffentlichen Schlüssel im Build passt.

## Einmalig: Schlüssel einrichten

1. Ein Schlüsselpaar erzeugen, lokal und nicht im Repository:
   ```bash
   pnpm tauri signer generate -w ~/.tauri/noteforge.key
   ```
   Das Kommando fragt nach einem Passwort und gibt den öffentlichen Schlüssel aus. Der liegt außerdem in `~/.tauri/noteforge.key.pub`.
2. Im GitHub-Repository unter **Settings → Secrets and variables → Actions** eintragen:
   - Secret `TAURI_SIGNING_PRIVATE_KEY`: Inhalt von `~/.tauri/noteforge.key`
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: das Passwort aus Schritt 1
   - Variable `TAURI_UPDATER_PUBKEY`: Inhalt von `~/.tauri/noteforge.key.pub`
3. Den privaten Schlüssel sicher aufbewahren. Geht er verloren, können installierte Versionen keine Updates mehr annehmen. Dann muss einmal manuell neu installiert werden.

Ohne diese Einträge baut der Workflow weiterhin Installer, aber ohne Auto-Update. Er gibt dann eine Warnung aus. Lokale Builds (`pnpm tauri build`) brauchen keinen Schlüssel und enthalten keinen Updater.

## Release veröffentlichen

1. Die Version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` und `package.json` erhöhen.
2. Committen, dann einen Tag setzen und pushen, z. B. `git tag v0.2.0 && git push origin v0.2.0`. Alternativ den Workflow **Release** manuell starten.
3. Der Workflow `.github/workflows/release.yml` erledigt dann Folgendes:
   - Er baut auf `windows-latest` NSIS- und MSI-Installer.
   - Er signiert sie für den Updater (`*.sig`).
   - Er lädt alles zusammen mit `latest.json` ins Release hoch.
4. Der Release-Text (`releaseBody`) erscheint in der App als Changelog. Passe ihn vor dem Taggen an oder bearbeite ihn danach auf GitHub.

## Verhalten in der App

- Etwa 10 s nach dem Start prüft die App im Hintergrund `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`. Im Akkubetrieb wartet sie 60 s.
- Gibt es ein Update, erscheint unten rechts der dezente Knopf „Update verfügbar“. Ein Klick darauf zeigt den Changelog und bietet zwei Wege:
  - **Jetzt installieren und neu starten**
  - **Beim Beenden installieren**: Das Update wird sofort geladen und beim Schließen des Fensters installiert.
- Unter Windows läuft die Installation im „passive“-Modus mit Fortschrittsfenster und ohne Rückfragen.
