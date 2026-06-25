import { NextResponse } from "next/server";
import {
  readWorkbookWorkspace,
  writeWorkbookWorkspace,
  type WorkbookWorkspaceData,
} from "@/lib/workbook-workspace-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const workspace = await readWorkbookWorkspace();
    return NextResponse.json(workspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load workbook workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = (await request.json()) as WorkbookWorkspaceData;
    const savedWorkspace = await writeWorkbookWorkspace({
      templates: Array.isArray(workspace.templates) ? workspace.templates : [],
      clients: Array.isArray(workspace.clients) ? workspace.clients : [],
      runResults: Array.isArray(workspace.runResults) ? workspace.runResults : [],
    });

    return NextResponse.json(savedWorkspace);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save workbook workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
