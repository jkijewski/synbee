import type { FeatureModule } from './types.js';

// Door locks (0008): Locked / Unlocked rather than On / Off, and unlocking always asks first, from the device page
// and when an action or rule step would unlock. Zigbee2MQTT's lock state is a binary with LOCK / UNLOCK values.
export const lock: FeatureModule = {
  id: 'lock',
  label: 'Lock',
  words: { on: 'Locked', off: 'Unlocked' },
  matches: (p) => p.type === 'binary' && p.valueOn === 'LOCK' && p.valueOff === 'UNLOCK' && p.property !== 'child_lock',
  operators: ['eq', 'ne'],
  confirm: (value, p) => (value === p.valueOff ? 'This unlocks the door. Unlock it?' : null),
};

/** The lock's own report of its position, including "not fully locked", which needs attention. */
export const lockState: FeatureModule = {
  id: 'lock_state',
  label: 'Lock position',
  readOnly: true,
  matches: (p) => p.type === 'enum' && p.property === 'lock_state',
  operators: ['eq', 'ne'],
  attention: (value) => (value === 'not_fully_locked' ? 'warning' : null),
};

/** The buttons lock on a radiator valve or a switch (child lock): Locked / Unlocked words, no question. */
export const childLock: FeatureModule = {
  id: 'child_lock',
  label: 'Child lock',
  words: { on: 'Locked', off: 'Unlocked' },
  matches: (p) => p.type === 'binary' && p.property === 'child_lock',
  operators: ['eq', 'ne'],
};
