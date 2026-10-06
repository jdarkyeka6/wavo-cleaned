export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supplied = String(req.query?.token || '');
  const oneShot = String(process.env.WAVES_IMPORT_ONESHOT_TOKEN || '');
  const jobSecret = String(process.env.WAVES_IMPORT_JOB_SECRET || '');
  if (!oneShot || !jobSecret || supplied !== oneShot) return res.status(401).json({ error: 'Unauthorized' });

  const action = String(req.query?.action || 'next');
  if (!['next', 'reset'].includes(action)) return res.status(400).json({ error: 'Unknown action' });

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'wavowaves.lol');
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const response = await fetch(`${proto}://${host}/api/waves-import-job`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jobSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action }),
  });

  const body = await response.json().catch(() => ({ error: 'Import job returned invalid JSON' }));
  return res.status(response.status).json(body);
}
