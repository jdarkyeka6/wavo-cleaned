export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const configured = String(process.env.WAVES_IMPORT_ONESHOT_TOKEN || "");
  const supplied = String(req.query?.token || "");
  if (!configured || supplied !== configured) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const jobSecret = String(process.env.WAVES_IMPORT_JOB_SECRET || "");
  if (!jobSecret) return res.status(503).json({ error: "Import job secret is not configured" });

  const host = process.env.VERCEL_URL || req.headers.host;
  if (!host) return res.status(500).json({ error: "Could not resolve deployment host" });
  const jobUrl = `https://${host}/api/waves-import-job`;
  const deadline = Date.now() + 48_000;
  const maxPages = Math.max(1, Math.min(40, Number(req.query?.pages || 30)));

  let action = String(req.query?.reset || "") === "1" ? "reset" : "next";
  let pages = 0;
  let last = null;

  while (pages < maxPages && Date.now() < deadline) {
    const response = await fetch(jobUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jobSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: body?.error || `Import page failed with ${response.status}`,
        pages,
        last,
      });
    }
    last = body;
    pages += 1;
    action = "next";
    if (body?.complete) break;
  }

  return res.status(200).json({
    pages,
    complete: Boolean(last?.complete),
    progress: last?.progress || null,
    batch: last?.batch || null,
  });
}
