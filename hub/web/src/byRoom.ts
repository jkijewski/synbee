/** Devices grouped by main room, for dropdowns. */
export function byRoom<T extends { room?: string | null }>(devices: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const d of devices) {
    const key = d.room ?? 'No room';
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === 'No room' ? 1 : b === 'No room' ? -1 : a.localeCompare(b)));
}
