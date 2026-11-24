import { useEffect, useState } from 'react';

// Material Symbols, bundled with the hub (no internet needed). Names are the font's ligatures.

export function Icon({ name, size, title }: { name: string; size?: string; title?: string }) {
  return (
    <span className="icon" aria-hidden={title ? undefined : true} title={title} style={size ? { fontSize: size } : undefined}>
      {name}
    </span>
  );
}

const SUGGESTED = [
  'lightbulb', 'light', 'light_group', 'wall_lamp', 'floor_lamp', 'toggle_on', 'switch', 'smart_outlet', 'outlet', 'power',
  'settings_remote', 'remote_gen', 'sensors', 'motion_sensor_active', 'sensor_door', 'window_sensor', 'thermometer',
  'humidity_percentage', 'water_damage', 'detector_smoke', 'co2', 'blinds', 'roller_shades', 'thermostat', 'mode_fan',
  'ac_unit', 'valve', 'lock', 'doorbell', 'siren', 'bolt', 'question_mark',
];

let allNames: Promise<string[]> | null = null;
// The full list of names comes from the font package's type file, loaded only when someone searches.
function loadNames(): Promise<string[]> {
  allNames ??= import('material-symbols/index.d.ts?raw').then((m: { default: string }) => [...m.default.matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]!));
  return allNames;
}

export const ROOM_ICONS = [
  'meeting_room', 'living', 'weekend', 'bed', 'bedroom_parent', 'bedroom_child', 'kitchen', 'dining', 'bathtub', 'shower',
  'desk', 'computer', 'chair', 'garage', 'yard', 'deck', 'balcony', 'stairs', 'door_front', 'home', 'cottage', 'local_laundry_service',
];

/** Icons that suit actions: lights, scenes, comfort, security and leaving or coming home. */
export const ACTION_ICONS = [
  'bolt', 'lightbulb', 'light_off', 'light_group', 'wb_sunny', 'bedtime', 'nightlight', 'wb_twilight', 'brightness_6', 'palette',
  'power_settings_new', 'toggle_on', 'toggle_off', 'movie', 'tv', 'music_note', 'restaurant', 'local_cafe', 'menu_book', 'desk',
  'computer', 'bed', 'weekend', 'bathtub', 'thermostat', 'mode_fan', 'ac_unit', 'blinds', 'roller_shades', 'garage', 'lock',
  'lock_open', 'door_front', 'home', 'logout', 'login', 'directions_walk', 'celebration', 'favorite', 'star', 'notifications_off',
  'shield', 'pets', 'child_care', 'eco',
];

export function IconPicker({
  value,
  auto,
  onPick,
  suggestions = SUGGESTED,
}: {
  value: string;
  auto?: string;
  onPick: (name: string | null) => void;
  suggestions?: string[];
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>(suggestions);
  useEffect(() => {
    const q = query.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!q) {
      setResults(suggestions);
      return;
    }
    let live = true;
    void loadNames().then((names) => live && setResults(names.filter((n) => n.includes(q)).slice(0, 80)));
    return () => {
      live = false;
    };
  }, [query, suggestions]);
  return (
    <div className="icon-picker">
      <div className="line">
        <input className="form-control form-control-sm" aria-label="Search icons" placeholder="Search icons, e.g. lamp, plug, door" value={query} onChange={(e) => setQuery(e.target.value)} />
        {auto && (
          <button className="btn btn-outline-secondary btn-sm" onClick={() => onPick(null)} title="Let the hub choose from the device's type">
            <Icon name={auto} /> Automatic
          </button>
        )}
      </div>
      <div className="icon-grid">
        {results.map((n) => (
          <button key={n} className={n === value ? 'selected' : undefined} title={n.replace(/_/g, ' ')} aria-label={n.replace(/_/g, ' ')} onClick={() => onPick(n)}>
            <Icon name={n} size="1.6rem" />
          </button>
        ))}
        {results.length === 0 && <span className="muted small">No icon matches.</span>}
      </div>
    </div>
  );
}
