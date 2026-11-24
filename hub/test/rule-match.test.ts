import { describe, expect, it } from 'vitest';
import { buttonTrigger, evaluateCondition, stateTrigger, timeTrigger } from '../src/rule-match.js';
import type { Rule } from '../src/rules.js';

// Matching events and conditions without a database or devices (0015).
const rule = (when: Rule['when']): Rule => ({ id: 1, name: 'r', enabled: true, draft: false, notes: '', when, if: { mode: 'all', conditions: [] }, then: [] }) as unknown as Rule;
const DEV = '0xa4c1380000000002';

describe('rule matching', () => {
  it('matches button presses by button and press, or by raw value', () => {
    const r = rule([{ type: 'button', device: DEV, button: 1, press: 'single_click' }]);
    expect(buttonTrigger(r, { ieee: DEV, raw: '1_single', button: 1, press: 'single_click' })).toBeDefined();
    expect(buttonTrigger(r, { ieee: DEV, raw: '1_double', button: 1, press: 'double_click' })).toBeUndefined();
    expect(buttonTrigger(rule([{ type: 'button', device: DEV, raw: 'arrow_up' }]), { ieee: DEV, raw: 'arrow_up' })).toBeDefined();
  });

  it('matches state changes to a value and threshold crossings, not first reports', () => {
    const to = rule([{ type: 'state', device: DEV, property: 'state', to: 'ON' }]);
    expect(stateTrigger(to, { ieee: DEV, state: { state: 'ON' }, previous: {}, changed: ['state'] })).toBeUndefined();
    expect(stateTrigger(to, { ieee: DEV, state: { state: 'ON' }, previous: { state: 'OFF' }, changed: ['state'] })).toBeDefined();
    const above = rule([{ type: 'state', device: DEV, property: 'temperature', above: 25 }]);
    expect(stateTrigger(above, { ieee: DEV, state: { temperature: 26 }, previous: { temperature: 24 }, changed: ['temperature'] })).toBeDefined();
    expect(stateTrigger(above, { ieee: DEV, state: { temperature: 27 }, previous: { temperature: 26 }, changed: ['temperature'] })).toBeUndefined();
  });

  it('fires time events on their minute and weekday', () => {
    const monday0700 = new Date(2026, 10, 16, 7, 0);
    expect(timeTrigger(rule([{ type: 'time', at: '07:00', days: [1] }]), monday0700)).toBeDefined();
    expect(timeTrigger(rule([{ type: 'time', at: '07:00', days: [2] }]), monday0700)).toBeUndefined();
    expect(timeTrigger(rule([{ type: 'every', minutes: 15 }]), monday0700)).toBeDefined();
  });

  it('evaluates conditions with the value they were decided on', () => {
    const value = (_: string, p: string) => ({ brightness: 120, state: 'ON' })[p];
    const now = new Date(2026, 10, 16, 22, 30);
    expect(evaluateCondition({ type: 'state', device: DEV, property: 'brightness', op: 'between', value: [100, 150] }, value, now)).toEqual({ met: true, actual: 120 });
    expect(evaluateCondition({ type: 'state', device: DEV, property: 'state', op: 'ne', value: 'ON' }, value, now)).toEqual({ met: false, actual: 'ON' });
    expect(evaluateCondition({ type: 'time', from: '22:00', to: '06:00' }, value, now)).toEqual({ met: true, actual: '22:30' });
    expect(evaluateCondition({ type: 'days', days: [6, 7] }, value, now)).toEqual({ met: false, actual: 'Mon' });
  });
});
