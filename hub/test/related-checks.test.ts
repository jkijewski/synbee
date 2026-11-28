import { describe, expect, it } from 'vitest';
import { DependencyIndex, type IndexInput } from '../src/related.js';
import type { Rule } from '../src/rules.js';
import type { Action } from '../src/actions.js';

// Automations and actions that use a sensor group or a check (0024) belong to the rooms of the devices behind it,
// and to the room it shows in; they never count as "used by" for deleting a device.

const LEAK = '0xa4c1380000000011';
const DOOR = '0xa4c1380000000012';
const LAMP = '0xa4c1380000000013';

function rule(id: number, when: Rule['when'], conditions: Rule['if']['conditions'] = []): Rule {
  return { id, name: `rule ${id}`, enabled: true, draft: false, when, if: { mode: 'all', conditions }, then: [] } as unknown as Rule;
}

function input(rules: Rule[], actions: Action[] = []): IndexInput {
  return {
    devices: [
      { ieee: LEAK, name: 'Leak sensor' },
      { ieee: DOOR, name: 'Door sensor' },
      { ieee: LAMP, name: 'Lamp' },
    ],
    groups: [],
    actions,
    rules,
    sensorGroups: [{ id: 1, name: 'Doors', roomId: null, members: [{ ieee: DOOR, property: 'contact' }] }],
    checks: [
      {
        id: 2,
        name: 'Bathroom flood',
        roomId: 30,
        if: { mode: 'any', conditions: [{ type: 'state', device: LEAK, property: 'water_leak', op: 'eq', value: true }] },
      },
      { id: 3, name: 'Doors closed', roomId: null, if: { mode: 'all', conditions: [{ type: 'sensors', group: 1, is: 'none' }] } },
    ],
  };
}

const rooms = [
  { id: 10, devices: [LEAK], alsoDevices: [] },
  { id: 20, devices: [DOOR], alsoDevices: [] },
  { id: 30, devices: [], alsoDevices: [] },
];

describe('sensor groups and checks in the dependency index', () => {
  it('places an automation triggered by a check in its devices\' rooms and the check\'s room', () => {
    const index = new DependencyIndex(input([rule(9, [{ type: 'check', check: 2, becomes: true, forMinutes: 2 }])]));
    expect(index.roomMembership(rooms).rules[9]?.sort()).toEqual([10, 30]);
    const leak = index.related('device', LEAK);
    expect(leak.rules).toEqual([expect.objectContaining({ id: 9, links: [{ role: 'trigger', via: 'check Bathroom flood' }] })]);
  });

  it('follows sensor group triggers, and checks built on sensor groups', () => {
    const index = new DependencyIndex(
      input([rule(1, [{ type: 'sensors', group: 1, becomes: 'some' }]), rule(2, [{ type: 'state', device: LAMP, property: 'state', becomes: 'ON' } as never], [{ type: 'check', check: 3, is: true }])]),
    );
    const m = index.roomMembership(rooms).rules;
    expect(m[1]).toEqual([20]);
    expect(m[2]).toEqual([20]);
    expect(index.related('device', DOOR).rules.map((r) => r.links)).toEqual([
      [{ role: 'trigger', via: 'sensor group Doors' }],
      [{ role: 'condition', via: 'check Doors closed, sensor group Doors' }],
    ]);
  });

  it('places actions by their "only when" conditions too', () => {
    const action = { id: 5, name: 'Away', draft: false, steps: [], if: { mode: 'all', conditions: [{ type: 'check', check: 2, is: false }] } } as unknown as Action;
    const index = new DependencyIndex(input([], [action]));
    expect(index.roomMembership(rooms).actions[5]?.sort()).toEqual([10, 30]);
  });

  it('never counts a device behind a sensor group or check as "used by" when deleting it', () => {
    const index = new DependencyIndex(input([rule(9, [{ type: 'check', check: 2, becomes: true }]), rule(1, [{ type: 'sensors', group: 1, becomes: 'some' }])]));
    expect(index.usedBy('device', LEAK).rules).toEqual([]);
    expect(index.usedBy('device', DOOR).rules).toEqual([]);
  });
});
