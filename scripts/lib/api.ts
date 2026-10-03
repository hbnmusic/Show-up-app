/** Calls the fp-job Edge Function. Needs FP_JOB_URL (the function URL) and JOB_TOKEN (the shared secret; never committed). */
import type { Api } from './scan';

export function makeApi(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Api {
  const url = env.FP_JOB_URL;
  const token = env.JOB_TOKEN;
  if (!url || !token) throw new Error('Set FP_JOB_URL and JOB_TOKEN.');
  return async (action, body = {}) => {
    const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-job-token': token }, body: JSON.stringify({ action, ...body }) });
    if (!res.ok) throw new Error(`fp-job ${action}: HTTP ${res.status}`);
    return (await res.json()) as Record<string, any>;
  };
}

export function arg(name: string, fallback: string, argv: string[] = process.argv): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
export const flag = (name: string, argv: string[] = process.argv) => argv.includes(`--${name}`);
