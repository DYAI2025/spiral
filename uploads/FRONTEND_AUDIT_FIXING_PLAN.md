# Frontend Audit & Fixing Plan — Helix Projects

## 1. Repository-/Paketbefund

Das hochgeladene ZIP `Spiral.zip` enthält **eine einzelne Single-File-HTML-Seite**:

```text
Helix Projects.html
```

Es gibt keine Build-Pipeline, kein `package.json`, keine Tests, keine Komponentenstruktur und keine statische Asset-Pipeline. Die Seite ist eine direkte HTML/CSS/ESM-Three.js-Experience.

## 2. Bewertungsmaßstab

Bewertet wurde nach:
- Webdesign-Qualität: visuelle Hierarchie, Responsiveness, Motion-Design, Fallback, Accessibility.
- Frontend-Architektur: Zustandsmodell, Event-Fluss, Render-Loop, DOM-Kopplung, Fehlertoleranz.
- Performance: Main-Thread-Arbeit, Render-Frequenz, WebGL-/CSS3D-Kosten, GPU-Druck, Netzwerk-Hints, mobile Skalierung.
- Robustheit: CDN-/WebGL-Failure, Resize-Verhalten, Reduced-Motion/Data, Fokus-Management.

## 3. Wichtigste Befunde vor dem Fix

| Priorität | Befund | Risiko | Status |
|---|---|---|---|
| P0 | Dauerhafte `requestAnimationFrame`-Schleife rendert WebGL + CSS3D permanent, auch wenn nichts passiert. | Hoher Akku-/CPU-/GPU-Verbrauch, Mobile Jank. | Gefixt |
| P0 | Fallback behauptet eine vereinfachte Listenansicht, enthält aber keine Projektliste. | Broken UX bei WebGL-/CDN-/Low-End-Geräten. | Gefixt |
| P1 | CDN-/Modul-Ladefehler können die Seite leer lassen, weil der Fallback erst im Modul-Code aktiviert wird. | Fragile erste Darstellung. | Gefixt |
| P1 | Resize ändert Helix-Konstanten, baut Geometrie/Kartenpositionen aber nicht neu. | Falsches Layout nach Breakpoint-Wechsel. | Gefixt |
| P1 | Karten nutzen CSS-Blur-Filter innerhalb transformierter CSS3D-Elemente. | Teure Compositing-Kosten, besonders mobil. | Gefixt |
| P1 | Pro Frame werden wiederholt mehrere DOM-Styles und Nav-Zustände geschrieben. | Layout-/Style-Arbeit pro Frame. | Gefixt |
| P2 | DPR bis 2 mit Antialiasing auf allen Geräten. | Zu hoher Pixel-Fill-Load auf HiDPI/Mobile. | Gefixt |
| P2 | Overlay hat Dialog-Rolle, aber keinen vollständigen Fokus-Kreislauf. | Accessibility-Lücke. | Gefixt |
| P2 | Externe Three.js-Module haben keine Preload-/Preconnect-Hints. | Verzögerter Start der ESM-Experience. | Gefixt |

## 4. Umgesetzte Änderungen

### Performance-Fixes

1. **Event-getriebene Render-Schleife**
   - Vorher: permanentes `requestAnimationFrame(animate)`.
   - Nachher: `invalidate()` startet Rendering nur bei Scroll, Pointer, Resize, Visibility-Resume oder laufender Interpolation.
   - Ergebnis: Im Idle-Zustand rendert die Seite nicht kontinuierlich weiter.

2. **Adaptive WebGL-Kosten**
   - DPR-Cap von bisher maximal `2` auf adaptiv `1.0–1.5` reduziert.
   - Antialiasing auf kleinen/reduzierten Umgebungen deaktiviert.
   - `powerPreference: 'high-performance'` explizit gesetzt.

3. **Adaptive Geometrie**
   - Helix-Segmente: vorher fix `480`, jetzt adaptiv `280/340/400`.
   - Glow-Tube-Segmente reduziert.
   - Partikel: vorher `420`, jetzt adaptiv `80/140/220/300`.

4. **DOM-Write-Minimierung**
   - Karten speichern letzte Scale/Opacity/Brightness/Active-Werte.
   - UI-Elemente werden gecacht.
   - Nav-/Progress-/Hero-Fade-Writes passieren nur bei tatsächlicher Änderung.

5. **Teure CSS-Filter entschärft**
   - Karten-Blur entfernt.
   - Brightness bleibt als leichter Tiefenhinweis erhalten.
   - Backdrop-Blur reduziert.

6. **Resize stabilisiert**
   - Resize ist per rAF gedrosselt.
   - Bei Breakpoint-Wechsel werden Helix-Geometrie und CSS3D-Karten sauber neu aufgebaut.
   - Alte Geometrien/Materialien werden disposed.

### Robustheits- und UX-Fixes

1. **Echter Fallback**
   - Statische Fallback-Liste mit allen Projekten eingebaut.
   - Funktioniert auch ohne WebGL.

2. **CDN-/Modul-Failure Guard**
   - Frühes Guard-Script aktiviert Fallback, falls Module nicht laden oder Boot länger scheitert.

3. **Reduced Motion / Save Data**
   - `prefers-reduced-motion` und `navigator.connection.saveData` reduzieren Animation und visuelle Kosten.

4. **Accessibility**
   - Dialog-Fokus wird beim Öffnen gespeichert und beim Schließen zurückgesetzt.
   - Tab-Fokus wird im Overlay gehalten.
   - Escape schließt Overlay weiterhin.
   - Mini-Nav setzt `aria-current`.

5. **SEO-/Initial-Load-Hints**
   - Meta description und theme-color ergänzt.
   - `preconnect` und `modulepreload` für Three.js-CDN ergänzt.

## 5. Messbare statische Kennzahlen

| Kennzahl | Vorher | Nachher |
|---|---:|---:|
| HTML-Größe | 38196 Bytes | 47374 Bytes |
| Hauptscript | 22359 Bytes | 27992 Bytes |
| CSS | 12686 Bytes | 13643 Bytes |
| Render-Loop | permanent | event-/interpolationsgetrieben |
| Karten-Blur | ja | nein |
| Fallback-Projektkarten | 0 | 12 |
| Modulepreload-Hints | 0 | 2 |
| Helix-Segmente | 480 fix | 280/340/400 adaptiv |
| Partikel | 420 fix | 80/140/220/300 adaptiv |

Hinweis: Die HTML-Datei ist nach dem Fix größer, weil ein echter statischer Fallback, Sicherheits-Guards und robustere Rendersteuerung ergänzt wurden. Die Laufzeitkosten sinken dennoch deutlich, da Idle-Rendering, teure Blur-Filter und unnötige DOM-Writes reduziert wurden.

## 6. Fixing Plan für Restarbeiten

| Phase | Maßnahme | Ziel | Akzeptanzkriterium |
|---|---|---|---|
| 1 | Browser-Realtest mit Lighthouse/WebPageTest durchführen | Laufzeitmetriken objektivieren | LCP, CLS, INP und JS-Main-Thread-Zeiten dokumentiert |
| 2 | Three.js lokal vendoren oder eigene Build-Pipeline einführen | CDN-Risiko und Cold-Start reduzieren | Seite funktioniert offline bzw. über eigene Assets |
| 3 | CSP definieren | Sicherheitsniveau erhöhen | Keine Inline-Policies ohne bewusste Entscheidung; Hash/Nonce-Strategie vorhanden |
| 4 | Komponentenstruktur einführen, falls Projekt wächst | Wartbarkeit | Daten, Renderer, UI, Overlay getrennt |
| 5 | Visual Regression einführen | Design-Stabilität | Desktop/Mobile-Screenshots im CI |
| 6 | Performance-Budget einführen | Nachhaltige Stabilität | Budget für JS, CSS, Frames, GPU-Fillrate dokumentiert |
| 7 | Keyboard-Navigation erweitern | Accessibility | Pfeiltasten wechseln Projekte, Fokuszustände klar sichtbar |
| 8 | Fehlertelemetrie optional ergänzen | Produktionsdiagnostik | Boot-/Fallback-Fehler werden anonymisiert sichtbar |

## 7. Validierung

Durchgeführt:
- ZIP entpackt und Struktur geprüft.
- JavaScript-Syntaxprüfung per `node --check`: erfolgreich.
- Doppelte IDs statisch geprüft: keine.
- Diff erstellt: `performance-fixes.diff`.

Nicht vollständig durchgeführt:
- Headless-Chromium-Renderprüfung/Lighthouse konnte in dieser Containerumgebung wegen GPU-/Chromium-Prozessproblemen nicht zuverlässig abgeschlossen werden. Ein echter Browser-Test auf Zielgerät/CI bleibt notwendig.

## 8. Enthaltene Dateien

```text
Helix Projects.optimized.html
performance-fixes.diff
FRONTEND_AUDIT_FIXING_PLAN.md
```
