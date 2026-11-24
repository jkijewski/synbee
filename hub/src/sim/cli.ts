import { startSimulator } from './simulator.js';
import { sampleBulbs, sampleDevices, sampleSensors, sampleSensorStates } from './sample-devices.js';

// SIM_LIGHTS=1 adds three colour bulbs, for working on lights; SIM_SENSORS=1 adds sensors, a lock and a radiator valve.
const lights = process.env.SIM_LIGHTS === '1';
const sensors = process.env.SIM_SENSORS === '1';
const devices = lights || sensors ? [...structuredClone(sampleDevices), ...(lights ? structuredClone(sampleBulbs) : []), ...(sensors ? structuredClone(sampleSensors) : [])] : undefined;
const sim = await startSimulator({ port: Number(process.env.SIM_PORT ?? 1883), ...(devices ? { devices } : {}) });
// The hub usually connects after the simulator starts, so the sensors report their starting values a little later too.
const reportSensors = async () => {
  for (const [name, values] of Object.entries(sampleSensorStates)) await sim.report(name, values);
};
if (sensors) for (const ms of [0, 5000, 20000]) setTimeout(() => void reportSensors(), ms);
// Changing values, for history graphs and energy totals: the plug uses 40–80 W, the room warms and cools a little.
if (sensors) {
  let energy = sampleSensorStates.desk_plug!.energy as number;
  setInterval(() => {
    const minute = Date.now() / 60_000;
    const power = Math.round(60 + 20 * Math.sin(minute / 7));
    energy = Math.round((energy + (power / 1000) * (30 / 3600)) * 10000) / 10000;
    void sim.report('desk_plug', { power, energy });
    void sim.report('living_climate', { temperature: Math.round((21 + 1.5 * Math.sin(minute / 30)) * 10) / 10, humidity: Math.round(48 + 4 * Math.cos(minute / 45)) });
  }, 30_000).unref();
}
console.log(`Zigbee2MQTT simulator on ${sim.url} with ${sim.devices.length} devices`);
const stop = async () => {
  await sim.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
