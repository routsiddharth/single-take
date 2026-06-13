import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getFeed, type Sort, type Window } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  const sp = req.nextUrl.searchParams;
  const sort = (sp.get("sort") ?? "hot") as Sort;
  const window = (sp.get("window") ?? "all") as Window;
  const cursor = sp.get("cursor");
  const authorHandle = sp.get("author") ?? undefined;

  const { items, nextCursor } = getFeed({
    sort: ["hot", "new", "top"].includes(sort) ? sort : "hot",
    window,
    cursor,
    viewerId: user?.id,
    authorHandle,
  });
  return NextResponse.json({ items, nextCursor });
}
