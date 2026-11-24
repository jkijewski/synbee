import { describe, expect, it } from 'vitest';
import { hexToHs, repeatable, withoutUnsupportedFade, z2mFriendlyName } from '../src/device-kinds.js';
import { sampleFadingBulb, sampleWz5 } from '../src/sim/sample-devices.js';

// The pure command rules (0009), without MQTT.
describe('device kinds', () => {
  it('makes ASCII friendly names', () => {
    expect(z2mFriendlyName('Salon Półka ')).toBe('salon_polka');
    expect(z2mFriendlyName('ąćęłńóśźż')).toBe('acelnoszz');
    expect(z2mFriendlyName('!!!')).toBe('device');
  });

  it('drops a fade only for devices without one', () => {
    expect(withoutUnsupportedFade(sampleWz5('0x1', 'a') as never, { state: 'ON', transition: 1 })).toEqual({ state: 'ON' });
    expect(withoutUnsupportedFade(sampleFadingBulb('0x2', 'b') as never, { state: 'ON', transition: 1 })).toEqual({ state: 'ON', transition: 1 });
  });

  it('repeats only what cannot apply twice', () => {
    expect(repeatable({ state: 'TOGGLE' }, { state: 'OFF' }, new Map())).toEqual({ state: 'OFF' });
    expect(repeatable({ state: 'TOGGLE' }, { state: undefined }, new Map())).toBeNull();
    expect(repeatable({ brightness_step: 20 }, { brightness: undefined }, new Map([['brightness_step', {}]]))).toBeNull();
    expect(repeatable({ brightness: 100, transition: 1 }, { brightness: 100 }, new Map())).toEqual({ brightness: 100, transition: 1 });
  });

  it('turns hex colours into hue and saturation', () => {
    expect(hexToHs('#ff0000')).toEqual({ hue: 0, saturation: 100 });
    expect(hexToHs('#00ff00')).toEqual({ hue: 120, saturation: 100 });
    expect(hexToHs('#ffffff')).toEqual({ hue: 0, saturation: 0 });
    expect(hexToHs('nope')).toBeNull();
  });
});
