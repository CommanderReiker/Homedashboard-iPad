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

## Wetter und Kalender

`weather.get_forecasts` wird getrennt für Stunden- und Tagesvorhersage verwendet. Nicht jede Integration unterstützt beide Arten. `calendar.get_events` fragt nur die lokal angegebenen Kalender ab. Anzeige: heute und morgen einschließlich ganztägiger Termine, vier Einträge je automatisch wechselnder Seite. Tagesgrenzen folgen der HA-Zeitzone.

Termintitel können persönliche Angaben enthalten und sind auf dem Display sichtbar. Die Karte schreibt sie weder in GitHub noch in eine mitgelieferte Konfigurationsdatei.
