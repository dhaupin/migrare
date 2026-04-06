// POST /api/migrate
// Body: { source: { zip: base64string, name: string }, dryRun?: boolean }
// Returns: MigrationResult + files array for zip download
import { migrateZip } from "../_engine.js";

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const { source, dryRun = false } = body;

    if (!source) {
      return Response.json({ error: "Missing source" }, { status: 400 });
    }

    if (source.zip) {
      const result = await migrateZip(source.zip, source.name ?? "project.zip", dryRun);
      return Response.json(result);
    }

    return Response.json(
      { error: "Only zip source is supported in the web version. Use the CLI for GitHub repos." },
      { status: 400 }
    );
  } catch (err) {
    return Response.json({ error: err.message ?? "Migration failed" }, { status: 500 });
  }
}
