# Lokale Konfiguration

Eigene Entitäts-IDs gehören in den **Rohkonfigurationseditor des eigenen HA-Dashboards**. Im öffentlichen Repository bleibt nur das neutrale Beispiel. Updates durch HACS ändern diese Einstellungen nicht.

## Kartenoptionen

| Option | Bedeutung / Standard |
| --- | --- |
| `type` | `custom:home-dashboard` |
| `rooms` | Liste von Raumzeilen; leer, solange nicht konfiguriert |
| `weather` | Eigene `weather`-Entität; standardmäßig nicht gesetzt |
| `calendars` | Liste eigener Kalender-IDs; standardmäßig leer |
| `battery_soc` | Sensor für Speicher-Ladezustand in Prozent; nicht gesetzt |
| `vehicle_name` | Frei wählbare Fahrzeugbezeichnung; Standard `Auto` |
| `entities` | Objekt mit Sensor-/Statuszuordnungen, siehe unten; alle Werte standardmäßig nicht gesetzt |
| `night_script` | Eigenes Skript; nicht gesetzt |
| `allow_night_action` | Standard `false`; nur mit konfiguriertem Skript und `true` erscheint ein ausführbarer Knopf |
| `price_factor` | Standard `100`: Tibber EUR/kWh zu ct/kWh |
| `tibber_home` | Exakter Antwortschlüssel bei mehreren Tibber-Häusern; sonst nicht nötig |
| `radar` | Einzelne Optionen überschreiben die unten beschriebenen Radar-Standardwerte |

## Räume

Eine Zeile enthält in dieser Reihenfolge:

```yaml
rooms:
  - [Raumname, sensor.demo_temperature, sensor.demo_humidity, sensor.demo_co2]
  - [Außen, sensor.demo_outside_temperature, sensor.demo_outside_humidity, null, sensor.demo_rain_today]
```

Die IDs sind Platzhalter und müssen lokal durch eigene ersetzt werden. Bei fehlendem CO₂-Sensor `null` verwenden. Die optionale fünfte ID zeigt Niederschlag statt CO₂. Bis zu acht Zeilen sind im iPad-Layout geprüft; viele weitere Zeilen oder vergrößerte Systemschrift können mehr Platz benötigen. Die Historie wird nur für die angegebenen Temperatursensoren abgefragt.

Erwartete Einheiten: Temperatur °C, Feuchte %, CO₂ ppm. Niederschlag verwendet die Einheit des Sensors, ersatzweise mm. CO₂-Farben: unter 1000 ppm grün, ab 1000 ppm gelb, ab 2000 ppm rot. Fehlende oder nicht verfügbare Messwerte erscheinen als `—`.

## Strompreis, PV und Fahrzeug

Unter `entities` stehen folgende optionalen Schlüssel:

```yaml
entities:
  current_price: sensor.demo_current_price
  pv_power: sensor.demo_pv_power
  pv_energy_today: sensor.demo_pv_energy_today
  vehicle_range: sensor.demo_vehicle_range
  vehicle_soc: sensor.demo_vehicle_soc
  vehicle_plug: binary_sensor.demo_vehicle_plug
  vehicle_charging: binary_sensor.demo_vehicle_charging
  vehicle_target_soc: sensor.demo_vehicle_target_soc
  vehicle_charged_today: sensor.demo_vehicle_charged_today
```

Erwartete Einheiten: aktueller Strompreis ct/kWh, PV-Leistung W, PV-Tagesertrag kWh, Fahrzeugreichweite km, Ladezustände %, heute geladene Energie kWh. Die beiden Fahrzeug-Statussensoren verwenden `on`/`off`. Nicht vorhandene Zuordnungen können entfallen oder `null` sein.

Der Preisverlauf wird mit `tibber.get_prices` getrennt vom aktuellen Preissensor abgefragt. Der Abruf ist aktiviert, wenn `entities.current_price` oder `tibber_home` konfiguriert ist. Bei mehreren Tibber-Häusern `tibber_home` setzen, damit keine falsche Auswahl erfolgt. Preise und Termine werden alle fünf Minuten, Wetter alle 30 Minuten und Temperatur-Min/Max alle 15 Minuten angefragt, solange die Seite aktiv ist.

### Strompreise vergrößern und auswählen

Das Preisdiagramm oder „Vergrößern ↗“ antippen, um die große Ansicht zu öffnen. Im großen Diagramm tippen oder mit gedrückter Maustaste bzw. dem Finger ziehen: Der gelbe Cursor markiert den Beginn des ausgewählten Preisintervalls. Darunter stehen Datum, Beginn/Ende und der von Tibber gelieferte Preis in ct/kWh. Es wird zwischen den Preisintervallen nicht interpoliert. Die Werte verwenden `price_factor` wie die kleine Ansicht. Die Ausgabe zeigt bis zu sechs Nachkommastellen, ohne künstlich auf volle Cent zu runden.

Der Zeitregler unter dem Diagramm lässt sich auch per Tastatur bedienen (Pfeile, Pos1/Ende). „Schließen“ oder Escape beendet die Großansicht. Die Zeitangaben folgen der HA-Zeitzone; der UTC-Versatz unterscheidet doppelte Uhrzeiten bei der Zeitumstellung. Wenn morgen noch keine Preise geliefert wurden, bleibt die Ansicht auf heute begrenzt. Bei Abruffehlern werden vorhandene letzte Daten mit einem Hinweis angezeigt.

Die Auswahl dient nur der Anzeige und löst keine Gerätesteuerung aus. Bei im geführten Zugriff deaktivierter Berührung am iPad kann auch diese Ansicht nicht geöffnet oder bedient werden.

## Radar

Standardmäßig gelten:

```yaml
radar:
  type: custom:weather-radar-card
  height: 100%
  data_source: DWD
  past_minutes: 60
  forecast_minutes: 60
  forecast_refresh_minutes: 15
  zoom_level: 8
```

Der Block kann entfallen oder nur gezielt geänderte Werte enthalten. Es werden keine festen Koordinaten mitgeliefert. Die installierte Weather Radar Card verwendet die lokale HA-Konfiguration. Der eingebettete Radarbereich ist nicht per Touch bedienbar. Eine Radarfortschreibung ist eine Kurzfristprognose, keine sichere Vorhersage neu entstehender Schauer.

### Regenradar und Wolken

Regenradar zeigt Niederschlag; auch eine geschlossene Wolkendecke kann auf einem Regenradar leer erscheinen. Für Wolken wäre eine zusätzliche, zeitgestempelte Satellitenebene (beobachtete Bewölkung) oder eine Modell-Ebene (vorhergesagte Bewölkung) nötig.

Die aktuell dokumentierten Optionen der eingebetteten [Weather Radar Card](https://github.com/jpettitt/weather-radar-card/blob/main/docs/configuration.md) und ihre [zusätzlichen Ebenen](https://github.com/jpettitt/weather-radar-card/blob/main/docs/overlays.md) enthalten keine Wolkenebene. Ein Satelliten-Kartenhintergrund zeigt die Erdoberfläche und ist kein aktuelles Wolkenbild. Ein erfundener YAML-Schalter wie `show_clouds` kann das deshalb nicht aktivieren.

Eine Erweiterung ist technisch möglich: Eine Kartenkomponente müsste eine geeignete Satelliten-/Bewölkungsquelle als transparente Ebene unterstützen. Diese wird über die geografische Karte und unter den Regen gelegt, mit auswählbarer Deckkraft, Zeitstempel und Quellenangabe. Für eine gemeinsame Animation müssen Regen- und Wolkenbilder zeitlich zusammenpassen; eine Regen-Kurzfristprognose liefert keine Wolkenprognose. Außerdem müssen Abdeckung, Browserzugriff (CORS), Nutzungsrechte und gegebenenfalls API-Zugang der Quelle passen. Vorhandene `radar`-Optionen reichen Einstellungen an die eingebettete Karte durch, erweitern aber deren unterstützte Datenquellen nicht.

Diese Version ergänzt keine Wolkendatenquelle und keine zusätzlichen externen Anfragen. Die Regenradar-Konfiguration bleibt verwendbar. Eine Wolkenanzeige benötigt eine Erweiterung oder einen Austausch der eingebetteten Karte mit einer dafür geeigneten Datenquelle.

## Wetter und Kalender

`weather.get_forecasts` wird getrennt für Stunden- und Tagesvorhersage verwendet. Nicht jede Integration unterstützt beide Arten. `calendar.get_events` fragt nur die lokal angegebenen Kalender ab. Anzeige: heute und morgen einschließlich ganztägiger Termine, vier Einträge je automatisch wechselnder Seite. Tagesgrenzen folgen der HA-Zeitzone.

Termintitel können persönliche Angaben enthalten und sind auf dem Display sichtbar. Die Karte schreibt sie weder in GitHub noch in eine mitgelieferte Konfigurationsdatei.
