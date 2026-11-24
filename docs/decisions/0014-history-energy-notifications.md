# 0014. Reading history, energy totals and notifications

## Decision

- **History:** every readable number and yes/no value is stored, except settings and link quality:
  - raw for 7 days;
  - as 5-minute averages (with minimum and maximum) for 90 days;
  - as hourly averages for 2 years.

  These periods and a cap on raw readings (2 million by default) can be changed on the Status page. A repeated value within a minute isn't stored twice. An hourly job rolls readings up and prunes them.
- **Graphs** on the device page show one reading for 24 hours, 7 days, 30 days or a year, drawn with uPlot. Yes/no values are drawn as steps labelled with their words.
- **Energy** is counted per device per day from increases of the device's `energy` counter. A drop to 1 kWh or less is a restart and counts from zero. A larger drop, or a jump of more than 50 kWh, is taken as a new base. The device page shows today, this month and a bar per day; the Devices page shows the total and each device's share.
- **Notifications:** an inbox behind a bell in the header shows the unread count, red when an alarm is unread, with links to the device or rule. The same notification within 10 minutes is folded into one; more than 60 an hour are dropped, except alarms. Leak, smoke, carbon monoxide and gas alarms notify when they start (a setting, on by default). Other channels, if added later, receive each new notification.

## Alternatives considered

- **A time-series database.** Another service for a household's few thousand readings a day; SQLite with rollups is enough and is backed up with the hub.
- **Energy from power × time.** Inaccurate with sparse reports.

## Consequences

- The database grows with the number of sensors; the raw cap protects the NAS.
