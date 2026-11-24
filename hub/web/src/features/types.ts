import type { Property } from '../api';

// The web side of a device feature module (0008): how a feature is controlled, edited in a step, and shown.
// The matching hub module (hub/src/features) holds units, conversions and checks; this only draws.

export interface ControlProps {
  prop: Property;
  value: unknown;
  /** Sends values to the device or group, e.g. { brightness: 102, transition: 1 }. */
  onSend: (values: Record<string, unknown>) => Promise<void> | void;
}
export interface EditorProps {
  prop: Property;
  value: unknown;
  onChange: (value: unknown) => void;
}
export interface FeatureUI {
  /** Live control on the device page and on light groups. */
  Control: (p: ControlProps) => React.ReactNode;
  /** Value chooser for an action or rule step, or a condition. */
  Editor: (p: EditorProps) => React.ReactNode;
  /** How a current value is shown. */
  Display: (p: { prop: Property; value: unknown }) => React.ReactNode;
}
