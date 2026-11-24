# 0004. TypeScript on a bundled Node.js 22, with SQLite

## Decision

- **Hub:** TypeScript on Node.js 22, Fastify for HTTP, MQTT.js for the broker connection.
- **Data:** SQLite through Node.js's built-in `node:sqlite`, with migrations in code. No native add-on has to be compiled for DSM, and no ORM is used.
- **Web UI:** React, built with Vite, styled with Bootstrap 5, icons from Material Symbols, graphs with uPlot. Everything is served by the hub; the UI needs no internet access.
- **The pure core is shared:** the device feature modules and capability parsing are imported by both the hub and the web UI, so values are shown and checked the same way everywhere.

## Alternatives considered

- **Python or Go.** Zigbee2MQTT already needs Node.js, so one runtime serves both.
- **PostgreSQL or a time-series database.** A household's data fits SQLite, which is backed up with one file.

## Consequences

- One pinned Node.js version runs everything; updating it is a new package version.
