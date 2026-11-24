// A made-up Tuya configuration export in the shape written by tools/tuya-export/export_config.py; every name,
// address and Tuya ID here is invented.
const ok = (result: unknown) => ({ result, success: true, t: 1, tid: 'x' });
const dev = (id: string, name: string, node_id: string, category: string, product_id: string, status: object[] = []) => ({
  id,
  name,
  node_id,
  category,
  product_id,
  sub: true,
  status,
});
const desk = dev('dev-desk', 'biurko robocze ', 'a4c1380000000001', 'tdq', 'prod-3ch', [
  { code: 'switch_1', value: false },
  { code: 'switch_type', value: 'flip' },
  { code: 'relay_status', value: '2' },
]);
const remote = dev('dev-remote', 'Wireless Switch', 'a4c1380000000002', 'wxkg', 'prod-remote', [{ code: 'battery_percentage', value: 68 }]);
const bulbs = [
  dev('dev-gora', 'salon góra', '60a423fffe000001', 'dd', 'prod-bulb'),
  dev('dev-polka', 'salon półka', '60a423fffe000002', 'dd', 'prod-bulb'),
  dev('dev-regal', 'salon regał', '60a423fffe000003', 'dd', 'prod-bulb'),
];
const toggle = (id: string, ch: number) => ({ action_executor: 'toggle', entity_id: id, executor_property: { function_code: `switch_${ch}`, function_value: 'toggle' } });
const scene = (id: string, name: string, actions: object[]) => ok({ id, name, type: 'scene', status: 'enable', running_mode: 'local', actions, conditions: [] });
const press = (id: string, button: number, sceneId: string, value = 'single_click') =>
  ok({
    id,
    name: 'trigger_wirelessSwitchBindScene_dev-remote',
    type: 'automation',
    status: 'enable',
    running_mode: 'local',
    actions: [{ action_executor: 'rule_trigger', entity_id: sceneId }],
    conditions: [{ code: 1, entity_id: 'dev-remote', entity_type: 'device_report', expr: { comparator: '==', status_code: `switch${button}_value`, status_value: value } }],
  });
const group = (fn: string, value: unknown) => ({ action_executor: 'device_group_issue', entity_id: '777', executor_property: { function_code: fn, function_value: value } });

export const tuyaExport = {
  exported_at: '2026-11-19T23:16:15+0100',
  calls: {
    '/v1.0/devices/dev-gateway': ok({ id: 'dev-gateway', name: 'Smart Gateway', sub: false, category: 'wg2' }),
    '/v1.0/devices/dev-gateway/sub-devices': ok([desk, remote, ...bulbs]),
    '/v1.0/homes/1/rooms': ok({ home_id: 1, name: 'Home', rooms: [{ name: 'gabinet', room_id: 11 }, { name: 'salon', room_id: 12 }] }),
    '/v1.0/homes/1/rooms/11/devices': ok([desk, remote]),
    '/v1.0/homes/1/rooms/12/devices': ok([]),
    '/v2.0/cloud/scene/rule/s-spot': scene('s-spot', 'Desk spot', [toggle('dev-desk', 1)]),
    '/v2.0/cloud/scene/rule/s-led': scene('s-led', 'Desk lamp', [toggle('dev-desk', 2)]),
    '/v2.0/cloud/scene/rule/s-regal': scene('s-regal', 'Desk shelf', [toggle('dev-desk', 3)]),
    '/v2.0/cloud/scene/rule/s-k1': scene('s-k1', 'Desk 1', [toggle('dev-desk', 1)]),
    '/v2.0/cloud/scene/rule/s-red': scene('s-red', 'salon red', [
      group('colour_data', '000603e8016c'),
      group('switch_led', true),
      group('colour_data', '000003e803e8'),
    ]),
    '/v2.0/cloud/scene/rule/s-white': scene('s-white', '"salon światła":On/Off:ON', [
      group('switch_led', true),
      group('work_mode', 'white'),
      group('work_mode', 'white'),
      group('colour_data', '007903e803e8'),
      group('work_mode', 'white'),
    ]),
    '/v2.0/cloud/scene/rule/s-weather': scene('s-weather', 'music', [group('music_data', 'abc')]),
    '/v2.0/cloud/scene/rule/a1': press('a1', 1, 's-spot'),
    '/v2.0/cloud/scene/rule/a2': press('a2', 2, 's-led'),
    '/v2.0/cloud/scene/rule/a3': press('a3', 3, 's-regal'),
    '/v2.0/cloud/scene/rule/a4': ok({
      id: 'a4',
      name: 'Sunset lights',
      type: 'automation',
      status: 'enable',
      actions: [{ action_executor: 'rule_trigger', entity_id: 's-white' }],
      conditions: [{ entity_type: 'weather', expr: { status_code: 'sunset' } }],
    }),
    '/v2.0/cloud/thing/group/777': ok({ id: 777, name: 'salon światła', product_id: 'prod-bulb' }),
    '/v2.0/cloud/thing/group/777/devices': { code: 1110, msg: 'illegal param', success: false },
  },
};
