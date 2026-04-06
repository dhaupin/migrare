// POST /api/scan
// Body: { source: { zip: base64string, name: string } }
import { scanZip } from "../_engine.js";

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const { source } = body;

    if (!source) {
      return Response.json({ error: "Missing source" }, { status: 400 });
    }

    if (source.zip) {
      const report = await scanZip(source.zip, source.name ?? "project.zip");
      return Response.json(report);
    }

    return Response.json(
      { error: "Only zip source is supported in the web version. Use the CLI for GitHub repos." },
      { status: 400 }
    );
  } catch (err) {
    return Response.json({ error: err.message ?? "Scan failed" }, { status: 500 });
  }
}
