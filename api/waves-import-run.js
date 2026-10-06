import { runImportPage } from "./waves-import-job.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");

  // Temporary bounded maintenance endpoint. It invokes the import core in this
  // same function process so deployment protection cannot block an internal
  // HTTP hop. Remove this endpoint when the one-time import is complete.
  const deadline = Date.now() + 48_000;
  const maxPages = Math.max(1, Math.min(40, Number(req.query?.pages || 30)));

  let action = String(req.query?.reset || "") === "1" ? "reset" : "next";
  let pages = 0;
  let last = null;

  while (pages < maxPages && Date.now() < deadline) {
    const result = await runImportPage(action);
    if (result.status !== 200) {
      return res.status(result.status).json({
        ...(result.body || { error: "Import failed" }),
        pages,
        last,
      });
    }
    last = result.body;
    pages += 1;
    action = "next";
    if (last?.complete) break;
  }

  return res.status(200).json({
    pages,
    complete: Boolean(last?.complete),
    progress: last?.progress || null,
    batch: last?.batch || null,
  });
}
