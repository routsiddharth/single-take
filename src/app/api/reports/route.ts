import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/db";
import { currentUser } from "@/lib/auth";
import { uuid } from "@/lib/ids";

export const runtime = "nodejs";

const Body = z.object({
  target_type: z.enum(["post", "comment", "user"]),
  target_id: z.string().min(1),
  reason: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const user = await currentUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid report" }, { status: 400 });
  const { target_type, target_id, reason } = parsed.data;
  sqlite
    .prepare(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (?,?,?,?,?)`,
    )
    .run(uuid(), user?.id ?? null, target_type, target_id, reason);
  return NextResponse.json({ ok: true });
}
