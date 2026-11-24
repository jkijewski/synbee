# SynBee hub

The hub service, web UI and supervisor for SynBee, the self-hosted Zigbee hub DSM package. Its design is in [docs/architecture.md](../docs/architecture.md), the decisions in [docs/decisions](../docs/decisions/README.md) and the requirements in [openspec/specs](../openspec/specs/).

## Layout

| Folder | Contents |
|---|---|
| `src/` | Hub service (TypeScript, Fastify, MQTT.js, `node:sqlite`) |
| `src/sim/` | Zigbee2MQTT simulator for development without a coordinator |
| `web/` | Web UI (React, Vite) |
| `supervisor/` | Runs the MQTT broker and the hub and Zigbee2MQTT processes |
| `zigbee2mqtt/` | Pinned Zigbee2MQTT, bundled into the package |

## Development

```
npm ci
npm test && npm run typecheck
npm run dev
```

`npm run dev` runs everything with the simulator, with data in `.dev-data/`. Open http://127.0.0.1:8090, set a password, and build rules under Automations.
