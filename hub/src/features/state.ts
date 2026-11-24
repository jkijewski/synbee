import type { FeatureModule } from './types.js';

// On/off of a light or a switch channel (state, state_l1…). Toggle keeps the light's last brightness: Zigbee lights
// remember their level when switched off and on.
export const state: FeatureModule = {
  id: 'state',
  label: 'On / off',
  matches: (p) => p.type === 'binary' && /^state(_.+)?$/.test(p.property),
  operators: ['eq', 'ne'],
  tuya: [
    {
      code: /^(switch_\d|switch_led|switch)$/,
      translate(code, value) {
        const prop = /^switch_(\d)$/.test(code) ? `state_l${code.slice(-1)}` : 'state';
        if (value === 'toggle') return { [prop]: 'TOGGLE' };
        if (typeof value === 'boolean') return { [prop]: value ? 'ON' : 'OFF' };
        return null;
      },
    },
  ],
};
