import { connection } from "next/server";
import { providerStatus } from "@/lib/research";

export async function GET() {
  // Read env at request time, so keys added after the build are picked up.
  await connection();
  return Response.json({ providers: providerStatus() });
}
