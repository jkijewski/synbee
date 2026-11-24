import type { FastifyInstance } from 'fastify';

export const TEST_PASSWORD = 'test-password-1234';

// Sets the owner password on a fresh hub and returns the session cookie header.
export async function signIn(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: TEST_PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  return String(res.headers['set-cookie']).split(';')[0]!;
}
