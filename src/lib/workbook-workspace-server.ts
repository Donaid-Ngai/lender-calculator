import { createClient } from "@supabase/supabase-js";
import type {
  SavedWorkbookRunResult,
  SavedWorkbookTemplate,
  WorkbookClientFile,
} from "@/lib/workbook-template-types";

export type WorkbookWorkspaceData = {
  templates: SavedWorkbookTemplate[];
  clients: WorkbookClientFile[];
  runResults: SavedWorkbookRunResult[];
};

type WorkbookWorkspaceRow = {
  templates: unknown;
  clients: unknown;
  run_results: unknown;
};

const sharedWorkspaceId = "shared";

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeWorkspaceRow(row: WorkbookWorkspaceRow | null): WorkbookWorkspaceData {
  return {
    templates: asArray<SavedWorkbookTemplate>(row?.templates),
    clients: asArray<WorkbookClientFile>(row?.clients),
    runResults: asArray<SavedWorkbookRunResult>(row?.run_results),
  };
}

export async function readWorkbookWorkspace() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("workbook_workspace")
    .select("templates, clients, run_results")
    .eq("id", sharedWorkspaceId)
    .maybeSingle<WorkbookWorkspaceRow>();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeWorkspaceRow(data ?? null);
}

export async function writeWorkbookWorkspace(workspace: WorkbookWorkspaceData) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("workbook_workspace")
    .upsert(
      {
        id: sharedWorkspaceId,
        templates: workspace.templates,
        clients: workspace.clients,
        run_results: workspace.runResults,
      },
      { onConflict: "id" }
    )
    .select("templates, clients, run_results")
    .single<WorkbookWorkspaceRow>();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeWorkspaceRow(data);
}
