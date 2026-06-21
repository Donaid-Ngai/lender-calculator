import { NextResponse } from "next/server";
import { callRentalFunction } from "@/lib/rental-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      payload?: Record<string, unknown>;
    };

    if (!body.action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    const data = await callRentalFunction(body.action, body.payload);
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected rental lending error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
