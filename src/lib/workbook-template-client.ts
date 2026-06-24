import type {
  SavedWorkbookTemplate,
  SavedWorkbookRunResult,
  WorkbookClientFile,
  WorkbookInputKind,
  WorkbookInputMapping,
  WorkbookOutputMapping,
  WorkbookRunResponse,
} from "@/lib/workbook-template-types";
import JSZip from "jszip";
import * as XLSX from "xlsx";

export type CellAddress = {
  column: number;
  row: number;
};

export type CellRange = {
  start: CellAddress;
  end: CellAddress;
};

export type WorkbookDropdownRule = {
  sheetName: string;
  range: string;
  options: string[];
};

export type WorkbookMetadata = {
  sheetNames: string[];
  dropdownRules: WorkbookDropdownRule[];
};

export const savedTemplatesKey =
  "rental-lender-calculator.workbook-templates.v1";
export const savedClientsKey = "rental-lender-calculator.workbook-clients.v1";
export const savedRunResultsKey =
  "rental-lender-calculator.workbook-run-results.v1";

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createInputKey(label: string) {
  const baseKey = toKey(label) || "input";
  return `${baseKey}_${createId("field").replace(/[^a-zA-Z0-9]/g, "").slice(-8)}`;
}

export function getAllTemplateInputLabels(templates: SavedWorkbookTemplate[]) {
  return Array.from(
    new Set(
      templates.flatMap((template) =>
        template.inputs.map((input) => input.label.trim()).filter(Boolean)
      )
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function getInputType(kind: WorkbookInputKind) {
  if (kind === "text") {
    return "text";
  }

  return "number";
}

export function coerceClientValue(kind: WorkbookInputKind, value: string) {
  if (kind === "boolean") {
    return value === "true";
  }

  if (kind === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return value;
}

export function normalizeWorkbookInputKind(kind: unknown): WorkbookInputKind {
  if (
    kind === "text" ||
    kind === "number" ||
    kind === "boolean" ||
    kind === "select"
  ) {
    return kind;
  }

  return "number";
}

export function normalizeClientValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

export function normalizeClientValueList(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return [value];
  }

  return [""];
}

function columnNameToNumber(columnName: string) {
  return columnName
    .toUpperCase()
    .split("")
    .reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
}

function columnNumberToName(column: number) {
  let remaining = Math.max(1, column);
  let name = "";

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return name;
}

export function parseCellAddress(value: string): CellAddress | null {
  const match = value.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    column: columnNameToNumber(match[1]),
    row: Number(match[2]),
  };
}

export function formatCellAddress(address: CellAddress) {
  return `${columnNumberToName(address.column)}${address.row}`;
}

export function parseCellRange(value: string): CellRange | null {
  const [startValue, endValue] = value.trim().toUpperCase().split(":");
  const start = parseCellAddress(startValue);
  const end = parseCellAddress(endValue ?? startValue);

  if (!start || !end) {
    return null;
  }

  return {
    start: {
      column: Math.min(start.column, end.column),
      row: Math.min(start.row, end.row),
    },
    end: {
      column: Math.max(start.column, end.column),
      row: Math.max(start.row, end.row),
    },
  };
}

export function formatCellRange(range: CellRange) {
  const start = formatCellAddress(range.start);
  const end = formatCellAddress(range.end);

  return start === end ? start : `${start}:${end}`;
}

export function shiftCellRange(value: string, direction: "right" | "down") {
  const range = parseCellRange(value);

  if (!range) {
    return "";
  }

  const rowSpan = range.end.row - range.start.row + 1;
  const columnSpan = range.end.column - range.start.column + 1;
  const rowOffset = direction === "down" ? rowSpan : 0;
  const columnOffset = direction === "right" ? columnSpan : 0;

  return formatCellRange({
    start: {
      column: range.start.column + columnOffset,
      row: range.start.row + rowOffset,
    },
    end: {
      column: range.end.column + columnOffset,
      row: range.end.row + rowOffset,
    },
  });
}

function cellRangesOverlap(left: CellRange, right: CellRange) {
  return !(
    left.end.column < right.start.column ||
    left.start.column > right.end.column ||
    left.end.row < right.start.row ||
    left.start.row > right.end.row
  );
}

function getTextContent(parent: Element, tagName: string) {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? "";
}

function trimFormula(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
}

function normalizeSheetTarget(target: string) {
  const normalized = target.replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function parseSheetReference(value: string, fallbackSheetName: string) {
  const normalized = trimFormula(value);
  const match = normalized.match(/^(?:'([^']+)'|([^!]+))!(.+)$/);

  if (match) {
    return {
      sheetName: match[1] ?? match[2],
      range: match[3].replace(/\$/g, ""),
    };
  }

  return {
    sheetName: fallbackSheetName,
    range: normalized.replace(/\$/g, ""),
  };
}

function getRangeValues(
  workbook: XLSX.WorkBook,
  sheetName: string,
  rangeValue: string
) {
  const sheet = workbook.Sheets[sheetName];
  const range = parseCellRange(rangeValue);

  if (!sheet || !range) {
    return [];
  }

  const values: string[] = [];

  for (let row = range.start.row; row <= range.end.row; row += 1) {
    for (let column = range.start.column; column <= range.end.column; column += 1) {
      const cell = sheet[formatCellAddress({ column, row })];
      const value = cell?.w ?? cell?.v;

      if (value !== undefined && value !== null && String(value).trim()) {
        values.push(String(value).trim());
      }
    }
  }

  return Array.from(new Set(values));
}

function parseDefinedNames(workbookXml: Document) {
  const definedNames = new Map<string, string>();

  for (const definedName of Array.from(workbookXml.getElementsByTagName("definedName"))) {
    const name = definedName.getAttribute("name");
    const value = definedName.textContent?.trim();

    if (name && value) {
      definedNames.set(name, value);
    }
  }

  return definedNames;
}

function resolveDropdownOptions(input: {
  workbook: XLSX.WorkBook;
  definedNames: Map<string, string>;
  formula: string;
  sheetName: string;
}) {
  const formula = trimFormula(input.formula);

  if (!formula) {
    return [];
  }

  if (formula.startsWith('"') && formula.endsWith('"')) {
    return formula
      .slice(1, -1)
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
  }

  const definedFormula = input.definedNames.get(formula);
  const reference = parseSheetReference(definedFormula ?? formula, input.sheetName);
  return getRangeValues(input.workbook, reference.sheetName, reference.range);
}

export async function extractWorkbookMetadata(file: File): Promise<WorkbookMetadata> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellFormula: true });
  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return {
      sheetNames: workbook.SheetNames,
      dropdownRules: [],
    };
  }

  const parser = new DOMParser();
  const workbookXmlText = await zip.file("xl/workbook.xml")?.async("text");
  const workbookRelsText = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");

  if (!workbookXmlText || !workbookRelsText) {
    return {
      sheetNames: workbook.SheetNames,
      dropdownRules: [],
    };
  }

  const workbookXml = parser.parseFromString(workbookXmlText, "application/xml");
  const workbookRelsXml = parser.parseFromString(workbookRelsText, "application/xml");
  const definedNames = parseDefinedNames(workbookXml);
  const relTargets = new Map<string, string>();

  for (const relationship of Array.from(
    workbookRelsXml.getElementsByTagName("Relationship")
  )) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");

    if (id && target) {
      relTargets.set(id, normalizeSheetTarget(target));
    }
  }

  const sheetFileByName = new Map<string, string>();

  for (const sheet of Array.from(workbookXml.getElementsByTagName("sheet"))) {
    const name = sheet.getAttribute("name");
    const relationId =
      sheet.getAttribute("r:id") ??
      sheet.getAttribute("id") ??
      sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = relationId ? relTargets.get(relationId) : null;

    if (name && target) {
      sheetFileByName.set(name, target);
    }
  }

  const dropdownRules: WorkbookDropdownRule[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheetPath = sheetFileByName.get(sheetName);
    const sheetXmlText = sheetPath ? await zip.file(sheetPath)?.async("text") : null;

    if (!sheetXmlText) {
      continue;
    }

    const sheetXml = parser.parseFromString(sheetXmlText, "application/xml");

    for (const validation of Array.from(
      sheetXml.getElementsByTagName("dataValidation")
    )) {
      if (validation.getAttribute("type") !== "list") {
        continue;
      }

      const formula = getTextContent(validation, "formula1");
      const options = resolveDropdownOptions({
        workbook,
        definedNames,
        formula,
        sheetName,
      });

      if (!options.length) {
        continue;
      }

      for (const range of (validation.getAttribute("sqref") ?? "").split(/\s+/)) {
        if (parseCellRange(range)) {
          dropdownRules.push({
            sheetName,
            range,
            options,
          });
        }
      }
    }
  }

  return {
    sheetNames: workbook.SheetNames,
    dropdownRules,
  };
}

export function getDropdownOptionsForRange(
  dropdownRules: WorkbookDropdownRule[],
  sheetName: string,
  cellRangeValue: string
) {
  const requestedRange = parseCellRange(cellRangeValue);

  if (!requestedRange) {
    return [];
  }

  const options: string[] = [];

  for (const rule of dropdownRules) {
    if (rule.sheetName !== sheetName) {
      continue;
    }

    const ruleRange = parseCellRange(rule.range);

    if (!ruleRange || !cellRangesOverlap(requestedRange, ruleRange)) {
      continue;
    }

    for (const option of rule.options) {
      options.push(option);
    }
  }

  return Array.from(new Set(options));
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function base64ToFile(base64: string, filename: string) {
  const byteCharacters = atob(base64);
  const bytes = new Uint8Array(byteCharacters.length);

  for (let index = 0; index < byteCharacters.length; index += 1) {
    bytes[index] = byteCharacters.charCodeAt(index);
  }

  return new File([bytes], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBase64Workbook(base64: string, filename: string) {
  const byteCharacters = atob(base64);
  const bytes = new Uint8Array(byteCharacters.length);

  for (let index = 0; index < byteCharacters.length; index += 1) {
    bytes[index] = byteCharacters.charCodeAt(index);
  }

  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readJsonArray<T>(key: string): T[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    const parsed = rawValue ? (JSON.parse(rawValue) as T[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(key: string, values: T[]) {
  window.localStorage.setItem(key, JSON.stringify(values));
}

export function readSavedTemplates() {
  return readJsonArray<SavedWorkbookTemplate>(savedTemplatesKey).map((template) => ({
    ...template,
    inputs: template.inputs.map((input) => ({
      ...input,
      key:
        input.key && input.key !== input.label
          ? input.key
          : createInputKey(input.label),
    })),
  }));
}

export function writeSavedTemplates(templates: SavedWorkbookTemplate[]) {
  writeJsonArray(savedTemplatesKey, templates);
}

export function readSavedClients() {
  return readJsonArray<WorkbookClientFile>(savedClientsKey);
}

export function writeSavedClients(clients: WorkbookClientFile[]) {
  writeJsonArray(savedClientsKey, clients);
}

export function readSavedRunResults() {
  return readJsonArray<SavedWorkbookRunResult>(savedRunResultsKey);
}

export function writeSavedRunResults(results: SavedWorkbookRunResult[]) {
  writeJsonArray(savedRunResultsKey, results);
}

export function upsertSavedRunResults(results: SavedWorkbookRunResult[]) {
  const byResultKey = new Map<string, SavedWorkbookRunResult>();

  for (const result of [...readSavedRunResults(), ...results]) {
    byResultKey.set(`${result.clientId}:${result.templateId}`, result);
  }

  const nextResults = Array.from(byResultKey.values()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );

  writeSavedRunResults(nextResults);
  return nextResults;
}

export function deleteSavedRunResultsForTemplate(templateId: string) {
  writeSavedRunResults(
    readSavedRunResults().filter((result) => result.templateId !== templateId)
  );
}

export function deleteSavedRunResultsForClient(clientId: string) {
  writeSavedRunResults(
    readSavedRunResults().filter((result) => result.clientId !== clientId)
  );
}

export async function runWorkbookTemplate(input: {
  workbook: File;
  templateInputs: WorkbookInputMapping[];
  templateOutputs: WorkbookOutputMapping[];
  client: WorkbookClientFile;
}): Promise<WorkbookRunResponse> {
  const formData = new FormData();
  formData.append("workbook", input.workbook);
  formData.append(
    "inputs",
    JSON.stringify(
      input.templateInputs.map((templateInput) => ({
        key: templateInput.key,
        label: templateInput.label,
        cell: templateInput.cell,
        sheetName: templateInput.sheetName || undefined,
        value: normalizeClientValueList(input.client.values[templateInput.label]).map(
          (value) => coerceClientValue(templateInput.kind, value)
        ),
      }))
    )
  );
  formData.append(
    "outputs",
    JSON.stringify(
      input.templateOutputs.map((templateOutput) => ({
        key: templateOutput.key,
        label: templateOutput.label,
        cell: templateOutput.cell,
        sheetName: templateOutput.sheetName || undefined,
      }))
    )
  );

  const response = await fetch("/api/workbook/run", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json()) as WorkbookRunResponse | { error?: string };

  if (!response.ok) {
    throw new Error("error" in data ? data.error : "Workbook run failed.");
  }

  return data as WorkbookRunResponse;
}

export function getTemplateInputCatalog(templates: SavedWorkbookTemplate[]) {
  const byKey = new Map<string, WorkbookInputMapping>();

  for (const template of templates) {
    for (const input of template.inputs) {
      const normalizedInput = {
        ...input,
        kind: normalizeWorkbookInputKind(input.kind),
      };

      if (!byKey.has(input.label)) {
        byKey.set(input.label, normalizedInput);
        continue;
      }

      const existingInput = byKey.get(input.label);

      if (existingInput) {
        byKey.set(input.label, {
          ...existingInput,
          key: input.label,
          kind:
            existingInput.kind === "select" || normalizedInput.kind === "select"
              ? "select"
              : existingInput.kind,
          options: Array.from(
            new Set([...(existingInput.options ?? []), ...(normalizedInput.options ?? [])])
          ),
        });
      }
    }
  }

  return Array.from(byKey.values());
}
