// GET /api/health
export async function onRequestGet() {
  return Response.json({ ok: true, version: "0.0.1" });
}
