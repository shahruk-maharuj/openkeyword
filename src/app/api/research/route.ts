import { research } from "@/lib/research";

const CODE = /^[a-z]{2}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const seed = (params.get("q") ?? "").trim();
  const country = (params.get("country") ?? "us").toLowerCase();
  const language = (params.get("lang") ?? "en").toLowerCase();

  if (!seed || seed.length > 80) {
    return Response.json({ error: "Enter a seed keyword (1–80 characters)." }, { status: 400 });
  }
  if (!CODE.test(country) || !CODE.test(language)) {
    return Response.json({ error: "Country and language must be two-letter codes." }, { status: 400 });
  }

  const started = Date.now();
  const rows = await research(seed, { country, language });
  return Response.json({ seed, country, language, count: rows.length, ms: Date.now() - started, rows });
}
