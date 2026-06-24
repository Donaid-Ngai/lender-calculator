export type WorkbookInputKind =
  | "text"
  | "number"
  | "boolean"
  | "select";

export type WorkbookInputMapping = {
  id: string;
  key: string;
  label: string;
  kind: WorkbookInputKind;
  sheetName: string;
  cell: string;
  options?: string[];
};

export type WorkbookOutputMapping = {
  id: string;
  key: string;
  label: string;
  sheetName: string;
  cell: string;
};

export type SavedWorkbookTemplate = {
  id: string;
  name: string;
  fileName: string;
  fileBase64: string;
  sheetNames: string[];
  defaultSheetName: string;
  inputs: WorkbookInputMapping[];
  outputs: WorkbookOutputMapping[];
  updatedAt: string;
};

export type WorkbookClientFile = {
  id: string;
  name: string;
  values: Record<string, string | string[]>;
  updatedAt: string;
};

export type WorkbookRunOutput = {
  key: string;
  label: string;
  sheetName: string;
  cell: string;
  value: string | number | boolean | null;
  displayValue: string;
  formula: string | null;
};

export type WorkbookRunResponse = {
  outputs: WorkbookRunOutput[];
  completedWorkbook: string;
  completedWorkbookName: string;
  recalc: {
    status: string;
    message: string;
  };
};

export type WorkbookDashboardRunResult = {
  templateId: string;
  templateName: string;
  response: WorkbookRunResponse;
};

export type SavedWorkbookRunResult = WorkbookDashboardRunResult & {
  clientId: string;
  updatedAt: string;
};
