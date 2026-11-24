import type { FastifyInstance } from 'fastify';
import { ImportError, importTuyaListing, parseListing } from '../tuya-import.js';
import { IMPORT_REPORT_KEY, importTuyaExport, isTuyaExport } from '../tuya-export.js';
import { Settings } from '../settings.js';
import type { RouteContext } from './context.js';

// The Tuya import (0017): a configuration export or a tinytuya devices.json listing, and its last report.
export function registerImportRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;
  // Accepts the raw devices.json text, or a configuration export.
  app.post('/api/import/tuya', { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    try {
      // The full configuration export (rooms, scenes, automations) or a plain tinytuya devices.json listing.
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // parseListing reports it.
      }
      if (isTuyaExport(parsed)) return importTuyaExport(db, parsed);
      return importTuyaListing(db, parseListing(raw));
    } catch (err) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get('/api/import/tuya/report', async () => new Settings(db).get(IMPORT_REPORT_KEY, null));
}
