# Lokale Konfiguration

Eigene Entitäts-IDs gehören in den **Rohkonfigurationseditor des eigenen HA-Dashboards**. Im öffentlichen Repository bleibt nur das neutrale Beispiel. Updates durch HACS ändern diese Einstellungen nicht.

## Kartenoptionen

| Option | Bedeutung / Standard |
| --- | --- |
| `type` | `custom:home-dashboard` |
| `view` | Standard `home`; `heating` für den separaten [Heizungsreiter](HEATING.md) |
| `heating` | Lokale Schalter- und Reglerzuordnungen für die Heizungsansicht; standardmäßig leer |
| `rooms` | Liste von Raumzeilen; leer, solange nicht konfiguriert; Außensensor als letzten Eintrag führen |
| `pm25` | Optionale Sensor-ID für PM2.5 mit aktuellem Wert und Tages-Min/Max; nicht gesetzt |
| `weather` | Eigene `weather`-Entität; standardmäßig nicht gesetzt |
| `calendars` | Liste eigener Kalender-IDs; standardmäßig leer |
| `battery_soc` | Sensor für Speicher-Ladezustand in Prozent; nicht gesetzt |
| `vehicle_name` | Feste Fahrzeugbezeichnung und Rückfallwert; Standard `Auto` |
| `vehicle_name_entity` | Optionale Text-Entität für den Fahrzeugnamen; hat bei gültigem Zustand Vorrang vor `vehicle_name` |
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

Die IDs sind Platzhalter und müssen lokal durch eigene ersetzt werden. Bei fehlendem CO₂-Sensor `null` verwenden. Die optionale fünfte ID zeigt Niederschlag statt CO₂. Bis zu acht Temperaturzeilen plus einer optionalen PM2.5-Zeile sind im iPad-Layout geprüft; viele weitere Zeilen oder vergrößerte Systemschrift können mehr Platz benötigen. Die Historie wird nur für die angegebenen Temperatursensoren und den optionalen PM2.5-Sensor abgefragt.

Erwartete Einheiten: Temperatur °C, Feuchte %, CO₂ ppm. Niederschlag verwendet die Einheit des Sensors, ersatzweise mm. CO₂-Farben: unter 1000 ppm grün, ab 1000 ppm gelb, ab 2000 ppm rot. Fehlende oder nicht verfügbare Messwerte erscheinen als `—`.

### PM2.5 mit Tages-Minimum und -Maximum

Ab V2.4.0 wird die Gute-Nacht-Kachel flacher (64 Pixel); der frei gewordene Platz vergrößert die Raumklima-Kachel. Eine optionale Partikelzeile steht direkt **vor dem letzten Eintrag** von `rooms`. Den Außensensor deshalb als letzte Raumzeile belassen. Die übrigen Raumzeilen werden nicht ersetzt oder entfernt.

Die Sensor-ID auf **Kartenebene** neben `weather`, `battery_soc` und `rooms` ergänzen, nicht unter `entities` oder in der Raumliste:

```yaml
type: custom:home-dashboard
pm25: sensor.demo_pm25  # lokal durch die eigene Sensor-ID ersetzen
```

Die Zeile zeigt **PM2.5**, den aktuellen Wert sowie **Min heute** und **Max heute**. Die Einheit kommt aus `unit_of_measurement` des Sensors, ersatzweise `µg/m³`. Es erfolgt keine Einheitenumrechnung oder Bewertung mit Gesundheitsgrenzwerten.

Die Tagesextrema werden aus der HA-Historie **ab Mitternacht in der HA-Zeitzone bis jetzt** berechnet, zusammen mit den Temperatur-Min/Max-Werten in einer gemeinsamen Abfrage. Das geschieht alle 15 Minuten, solange die Seite aktiv ist; der aktuelle Wert aktualisiert sich unabhängig davon mit den HA-Zuständen. Voraussetzung für Tages-Min/Max ist, dass der HA-Recorder den PM2.5-Sensor aufzeichnet. Es sind die Extrema der verfügbaren aufgezeichneten Werte, keine Hochrechnung.

Unbekannte oder nicht verfügbare Zustände erscheinen als `—`; echte Nullwerte bleiben `0,0`. Bei leerer Historie oder fehlgeschlagenem Abruf erscheinen die Tagesextrema als `—`. Ein Abruffehler erhält zusätzlich einen Hinweis in der Raumklima-Kachel. Ohne `pm25`-Zuordnung entfällt die zusätzliche Zeile und es wird dafür keine Historie angefragt. PM2.5 lässt sich auch ohne konfigurierte Temperaturzeilen anzeigen.

Die Gute-Nacht-Funktion bleibt standardmäßig gesperrt. Falls sie ausdrücklich freigegeben ist, bleibt der Knopf trotz kleinerer Kachel mindestens 44 Pixel hoch.

## Strompreis, PV und Fahrzeug

Ab V2.1.2 kann der Fahrzeugname aus einer Text-Entität kommen. Beide Optionen stehen direkt in der Kartenkonfiguration, auf derselben Ebene wie `weather`:

```yaml
type: custom:home-dashboard
vehicle_name: Auto
vehicle_name_entity: input_text.demo_vehicle_name
```

Die Entitäts-ID durch den eigenen Text-Helfer ersetzen. Angezeigt wird dessen Zustand, nicht sein `friendly_name`. Änderungen werden mit den HA-Zustandsaktualisierungen übernommen. Fehlt die Entität oder ist ihr Zustand leer, `unknown` oder `unavailable`, erscheint stattdessen `vehicle_name`. Ohne `vehicle_name_entity` bleibt der feste Name erhalten.

Unter `entities` stehen folgende optionalen Schlüssel:

```yaml
entities:
  current_price: sensor.demo_current_price
  pv_power: sensor.demo_pv_power
  pv_energy_today: sensor.demo_pv_energy_today
  electricity_consumption_today: sensor.demo_electricity_consumption_today
  electricity_cost_today: sensor.demo_electricity_cost_today
  vehicle_range: sensor.demo_vehicle_range
  vehicle_soc: sensor.demo_vehicle_soc
  vehicle_plug: binary_sensor.demo_vehicle_plug
  vehicle_charging: binary_sensor.demo_vehicle_charging
  vehicle_target_soc: sensor.demo_vehicle_target_soc
  vehicle_charged_today: sensor.demo_vehicle_charged_today
```

Erwartete Einheiten: aktueller Strompreis ct/kWh, PV-Leistung W, PV-Tagesertrag kWh, Strom-Tagesverbrauch kWh, Stromkosten als Geldbetrag für heute, Fahrzeugreichweite km, Ladezustände %, heute geladene Energie kWh. Die beiden Fahrzeug-Statussensoren verwenden `on`/`off`. Nicht vorhandene Zuordnungen können entfallen oder `null` sein.

Der Preisverlauf wird mit `tibber.get_prices` getrennt vom aktuellen Preissensor abgefragt. Der Abruf ist aktiviert, wenn `entities.current_price` oder `tibber_home` konfiguriert ist. Bei mehreren Tibber-Häusern `tibber_home` setzen, damit keine falsche Auswahl erfolgt. Preise und Termine werden alle fünf Minuten, Wetter alle 30 Minuten und Temperatur-Min/Max alle 15 Minuten angefragt, solange die Seite aktiv ist.

### Strom, BKW & Batterie

Ab V2.3.0 tauschen Kalender und Energiekachel ihre Positionen. **Strom, BKW & Batterie** steht jetzt mittig unter dem Preisdiagramm; der kompakte Kalender steht darunter.

Die Energiekachel zeigt:

| Wert | Lokale Zuordnung | Erwarteter Sensorwert |
| --- | --- | --- |
| Verbrauch heute | `entities.electricity_consumption_today` | Numerische Tagessumme in kWh |
| Stromkosten heute | `entities.electricity_cost_today` | Numerische Kostensumme für heute in der Geldeinheit des Sensors |
| BKW-Leistung | `entities.pv_power` | Aktuelle Leistung in W |
| Ertrag heute | `entities.pv_energy_today` | Tagesertrag in kWh |
| Speicher-SOC | `battery_soc` | Ladezustand in Prozent; weiterhin auf Kartenebene |

Die beiden neuen Zuordnungen im **bestehenden** `entities:`-Block deiner lokalen Karte ergänzen. Die Beispiel-IDs durch eigene Tageszähler ersetzen; die vorhandenen Zuordnungen stehen lassen. Der [vollständige YAML-Vorschlag](../dashboard/dashboard.example.yaml) enthält nur synthetische Platzhalter.

Verbrauch und Kosten werden direkt aus den Sensorzuständen übernommen und mit zwei Nachkommastellen angezeigt. Die Tagesabgrenzung und das Zurücksetzen übernimmt der jeweilige HA-Sensor. Es gibt keine eigene Summierung und keine Berechnung „Tagesverbrauch × aktueller Strompreis“; insbesondere bei variablen Tarifen muss der Kostensensor die zeitabhängigen Preise bereits berücksichtigen.

Für die Kosten wird `unit_of_measurement` des Sensors angezeigt, ersatzweise die HA-Währung und schließlich `€`. Die Karte rechnet weder Wh in kWh noch Cent in Euro um. Fehlende Zuordnungen und Zustände wie `unknown` oder `unavailable` erscheinen als `—`; echte Nullwerte bleiben sichtbar. Änderungen werden mit den HA-Zuständen übernommen. Die neuen Werte lösen keine zusätzlichen Service- oder Historienabfragen aus.

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

`weather.get_forecasts` wird getrennt für Stunden- und Tagesvorhersage verwendet. Nicht jede Integration unterstützt beide Arten. `calendar.get_events` fragt nur die lokal angegebenen Kalender ab. Anzeige: heute und morgen einschließlich ganztägiger Termine. Seit V2.3.0 zeigt die kompakte Kachel jeweils einen Termin; bei mehreren Einträgen wechselt sie alle 15 Sekunden zum nächsten und zeigt die Seitennummer. Lange Titel werden gekürzt; der vollständige Text steht zusätzlich im Titelattribut. Tagesgrenzen folgen der HA-Zeitzone.

Termintitel können persönliche Angaben enthalten und sind auf dem Display sichtbar. Die Karte schreibt sie weder in GitHub noch in eine mitgelieferte Konfigurationsdatei.
