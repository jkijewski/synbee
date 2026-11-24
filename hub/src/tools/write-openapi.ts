import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appApiOpenApi } from '../app-api-schema.js';

// `npm run openapi`: writes openapi/app-api.json at the repository root from the app API's schemas.
const target = fileURLToPath(new URL('../../../openapi/app-api.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(appApiOpenApi(), null, 2)}\n`);
console.log(`written ${target}`);
