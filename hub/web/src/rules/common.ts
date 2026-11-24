import type { Rule, RuleRun, Weekday } from '../api';

// Shared by the Automations page's parts (0010).
export const DAYS: Array<[Weekday, string]> = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];
export const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
export const PRESS_NAMES: Record<string, string> = { single_click: 'single click', double_click: 'double click', long_press: 'long press' };
export const OUTCOME: Record<RuleRun['outcome'], string> = {
  running: 'running',
  completed: 'completed',
  skipped: 'skipped',
  failed: 'failed',
  stopped: 'stopped',
  ignored: 'ignored',
  interrupted: 'interrupted',
};

export const blank = (): Rule => ({ name: '', enabled: true, draft: false, notes: '', when: [], if: { mode: 'all', conditions: [] }, then: [] });
export const when = (iso: string) => new Date(iso).toLocaleString();
