# 0003. One supervisor, with the MQTT broker inside it

## Context

The hub and Zigbee2MQTT are separate programs that must start, restart and stop together, and the radio must survive restarts of the hub.

## Decision

- DSM's `start-stop-status` script starts one **supervisor** process. It starts the hub and Zigbee2MQTT as child processes, and restarts a crashed one with backoff: from 1 s, doubling, up to 30 s. It stops both cleanly with the package and writes a health file.
- **The MQTT broker (Aedes) runs inside the supervisor,** on 127.0.0.1 with a generated password. A hub restart therefore doesn't disconnect Zigbee2MQTT.
- **Logs** go to the package's private folder, with rotation. When a child exits unexpectedly, the supervisor logs why: the error lines of its last output, or its last lines.
- Zigbee2MQTT is restarted (for example after a gateway setting changes) by a signal to the supervisor; the hub never needs root or a shell for it.
- The rule engine runs inside the hub, so there are only two child processes.

## Alternatives considered

- **Separate DSM services per program.** DSM packages have one start script, and a supervisor gives health and restart control in one place.
- **An external broker (Mosquitto).** One more binary to build per architecture, for a broker that only two local processes use.

## Consequences

- If the supervisor dies, DSM reports the package as stopped, and Package Center can start it again.
- Zigbee2MQTT's own frontend is never started.
