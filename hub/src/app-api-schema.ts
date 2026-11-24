// The app API's contract (0021): every route's request and answer as JSON Schema. The app listener serves the routes
// with these schemas, so answers are serialized by them, and the OpenAPI document (openapi/app-api.json) is generated
// from them; a test fails when the committed document and this file disagree.

export const APP_API_PREFIX = '/api/app/v1';

type Schema = Record<string, unknown>;

const str = (description?: string): Schema => ({ type: 'string', ...(description ? { description } : {}) });
const int = (description?: string): Schema => ({ type: 'integer', ...(description ? { description } : {}) });
const bool = (description?: string): Schema => ({ type: 'boolean', ...(description ? { description } : {}) });
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as string, 'null'] });
const object = (properties: Record<string, Schema>, required = Object.keys(properties), description?: string): Schema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
});
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

/** Shared shapes, referenced from the routes. Fastify resolves them by `$id`; OpenAPI by components. */
export const APP_API_COMPONENTS: Record<string, Schema> = {
  Error: object({ error: str('What went wrong, in words to show the user') }),
  ActionState: {
    type: ['string', 'null'],
    enum: ['active', 'partly', 'inactive', null],
    description: "Whether the action's devices show what it sets; null when unknown",
  },
  Power: {
    type: ['string', 'null'],
    enum: ['on', 'partly', 'off', null],
    description: "How the tile is coloured: what the action switches is on, partly on or off; null when it shows nothing",
  },
  Reading: object({
    property: str("The device's property, as Zigbee2MQTT names it"),
    label: str('Its name in words, e.g. "Temperature"'),
    text: str('Its value in words, e.g. "21.4 °C" or "Open"'),
    attention: { type: ['string', 'null'], enum: ['alarm', 'warning', null], description: 'Whether the value needs attention' },
  }),
  Device: object({
    ieee: str("The device's IEEE address"),
    name: str(),
    room: nullable(str('The room it is in')),
    online: nullable(bool('Whether it answers; null when unknown')),
    summary: str('"On · red · 30 %", "21.4 °C · 48 %", or empty when nothing is known'),
    readings: { type: 'array', items: ref('Reading') },
    battery: nullable({ type: 'number', description: 'Battery level in %' }),
    lastSeen: nullable(str('When it was last heard from (ISO 8601)')),
  }),
  Room: object({
    id: int(),
    name: str(),
    icon: str('A Material Symbols icon name'),
    color: str("The room's colour, #rrggbb"),
  }),
};

const errors = { '4xx': ref('Error'), '5xx': ref('Error') };

export interface AppRoute {
  method: 'GET' | 'POST';
  /** Under APP_API_PREFIX, Fastify style (`/actions/:id/run`). */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  /** False for the two routes a phone uses before it has a token. */
  auth: boolean;
  params?: Schema;
  body?: Schema;
  response: Schema;
}

const idParam = (what: string) => object({ id: { type: 'string', description: `The ${what}'s id; anything else answers 404` } });

export const APP_ROUTES: AppRoute[] = [
  {
    method: 'GET',
    path: '/ping',
    operationId: 'ping',
    summary: 'Check that an address is a SynBee hub',
    description: 'Says which API version the hub speaks, before pairing. Nothing about members or devices. Accepted from anywhere.',
    auth: false,
    response: object({ hub: { type: 'string', const: 'synbee' }, api: int('The app API version, 1'), version: str("SynBee's version") }),
  },
  {
    method: 'POST',
    path: '/pair',
    operationId: 'pair',
    summary: 'Pair this phone with a one-time code',
    description:
      'The code comes from the hub\'s App users page (QR code or typed), is valid once and for 10 minutes. Accepted from anywhere; at most 10 attempts a minute per address. The token is returned only here; the hub keeps only its hash.',
    auth: false,
    body: object({ code: str('The pairing code, e.g. K7M4Q-X92PA'), phoneName: str('Shown on the App users page, e.g. "Pixel 8"') }, ['code']),
    response: object({ token: str('The phone token, sent as `Authorization: Bearer <token>`'), member: str("The member's name"), phone: str("The phone's name") }),
  },
  {
    method: 'GET',
    path: '/connection',
    operationId: 'connection',
    summary: 'Where the phone can reach the hub',
    description: "The hub's home addresses and, when the owner allows the app away from home for this phone, the outside address.",
    auth: true,
    response: object({
      home: { type: 'array', items: str('host:port'), description: "The hub's home network addresses" },
      outside: { type: 'array', items: str('host:port'), description: 'The outside address, when this phone may use it' },
      outsideAllowed: bool('Whether this phone may be used away from home'),
      hubAllowsOutside: bool('Whether the hub accepts the app away from home at all'),
    }),
  },
  {
    method: 'GET',
    path: '/me',
    operationId: 'me',
    summary: 'Who this phone is',
    auth: true,
    response: object({
      member: str(),
      phone: str(),
      hubVersion: str(),
      actions: int('How many actions the member may run'),
      rooms: int('How many rooms the member may see'),
    }),
  },
  {
    method: 'GET',
    path: '/actions',
    operationId: 'actions',
    summary: 'The actions the member may run',
    auth: true,
    response: { type: 'array', items: object({ id: int(), name: str(), icon: str('A Material Symbols icon name'), description: str() }) },
  },
  {
    method: 'GET',
    path: '/home',
    operationId: 'home',
    summary: "The app's home screen: the member's rooms and actions, with their state",
    description:
      "Rooms in the owner's order with their colours. An action is listed under each allowed room of its devices; one with no rooms is in none (\"Other\" in the app); one whose rooms are all taken away isn't listed.",
    auth: true,
    response: object({
      rooms: { type: 'array', items: ref('Room') },
      actions: {
        type: 'array',
        items: object({
          id: int(),
          name: str(),
          icon: str('A Material Symbols icon name'),
          description: str(),
          rooms: { type: 'array', items: int(), description: 'The ids of the rooms it is listed under' },
          state: ref('ActionState'),
          power: ref('Power'),
          status: str('The tile\'s line, e.g. "Off" or "2 of 3 on"'),
        }),
      },
    }),
  },
  {
    method: 'GET',
    path: '/actions/:id/details',
    operationId: 'actionDetails',
    summary: 'What an action touches, device by device',
    auth: true,
    params: idParam('action'),
    response: object({
      id: int(),
      name: str(),
      state: ref('ActionState'),
      status: str(),
      targets: {
        type: 'array',
        items: {
          oneOf: [
            object({ kind: { type: 'string', const: 'device' }, device: ref('Device') }),
            object({ kind: { type: 'string', const: 'group' }, name: str(), summary: str(), devices: { type: 'array', items: ref('Device') } }),
          ],
        },
      },
    }),
  },
  {
    method: 'GET',
    path: '/rooms/:id',
    operationId: 'room',
    summary: "A room's devices, in words",
    auth: true,
    params: idParam('room'),
    response: object({ id: int(), name: str(), icon: str(), color: str('#rrggbb'), devices: { type: 'array', items: ref('Device') } }),
  },
  {
    method: 'POST',
    path: '/actions/:id/run',
    operationId: 'runAction',
    summary: 'Run an action',
    description: 'Drafts and actions the member may not run answer 404, like missing ones.',
    auth: true,
    params: idParam('action'),
    response: object({ ok: bool(), failedStep: int('The step that failed, from 1'), error: str() }, ['ok']),
  },
];

/** Fastify's route schema for one route: components resolved by `$id` (see addAppApiSchemas). */
export function fastifySchema(route: AppRoute): Schema {
  const fix = (s: Schema): Schema => JSON.parse(JSON.stringify(s).replaceAll('#/components/schemas/', 'synbee-app#/components/schemas/')) as Schema;
  return {
    ...(route.params ? { params: fix(route.params) } : {}),
    ...(route.body ? { body: fix(route.body) } : {}),
    response: { 200: fix(route.response), ...Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, fix(v)])) },
  };
}

/** The shared shapes as one schema Fastify can resolve `synbee-app#/components/schemas/…` against. */
export function componentsSchema(): Schema {
  const fixed = JSON.parse(JSON.stringify(APP_API_COMPONENTS).replaceAll('#/components/schemas/', 'synbee-app#/components/schemas/')) as Schema;
  return { $id: 'synbee-app', type: 'object', components: { schemas: fixed } };
}

/** The OpenAPI 3.1 document of the app API, from the routes above. */
export function appApiOpenApi(): Schema {
  const paths: Record<string, Record<string, Schema>> = {};
  for (const r of APP_ROUTES) {
    const path = APP_API_PREFIX + r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const parameters = r.params
      ? Object.entries((r.params.properties ?? {}) as Record<string, Schema>).map(([name, schema]) => {
          const { description, ...rest } = schema;
          return { name, in: 'path', required: true, description, schema: rest };
        })
      : undefined;
    const json = (schema: Schema) => ({ 'application/json': { schema } });
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = {
      operationId: r.operationId,
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      ...(r.auth ? {} : { security: [] }),
      ...(parameters ? { parameters } : {}),
      ...(r.body ? { requestBody: { required: true, content: json(r.body) } } : {}),
      responses: {
        200: { description: 'OK', content: json(r.response) },
        ...(r.auth ? { 401: { description: 'No token, or the phone was revoked: pair again', content: json(ref('Error')) } } : {}),
        403: { description: 'From outside the home network while not allowed', content: json(ref('Error')) },
        ...(r.params ? { 404: { description: 'Not found, or not allowed for this member', content: json(ref('Error')) } } : {}),
        429: { description: 'Too many requests; see Retry-After', content: json(ref('Error')) },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'SynBee app API',
      version: '1',
      summary: 'The API the SynBee mobile app uses to talk to a SynBee hub.',
      description:
        "Served by the hub on its own port (8443 by default) over TLS with the hub's own key, which the app pins by its SHA-256 SPKI fingerprint from pairing, instead of certificate authorities. Reachable from the home network, and from outside when the owner allows it. Answers are JSON and never cached. Breaking changes get a new version prefix. Generated from hub/src/app-api-schema.ts; don't edit by hand.",
      license: { name: 'MIT', identifier: 'MIT' },
      contact: { name: 'Jacek Kijewski', email: 'jacek.kijewski.gdynia@gmail.com' },
    },
    servers: [{ url: 'https://{host}:{port}', variables: { host: { default: '192.168.1.20' }, port: { default: '8443' } } }],
    security: [{ phoneToken: [] }],
    paths,
    components: {
      schemas: APP_API_COMPONENTS,
      securitySchemes: { phoneToken: { type: 'http', scheme: 'bearer', description: 'The token from POST /pair' } },
    },
  };
}
