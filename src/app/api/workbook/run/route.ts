import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import type {
  WorkbookInputMapping,
  WorkbookOutputMapping,
} from "@/lib/workbook-template-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WorkbookRunInputMapping = Omit<WorkbookInputMapping, "id" | "kind"> & {
  value:
    | string
    | number
    | boolean
    | null
    | Array<string | number | boolean | null>;
};

type SheetTarget = {
  name: string;
  path: string;
};

type WorkbookCellPatch = {
  sheetName: string;
  cell: string;
  value: WorkbookCellInputValue;
};

function execFileAsync(command: string, args: string[], timeout = 60_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parseJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeCellAddress(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeCellRange(value: string): XLSX.Range {
  return XLSX.utils.decode_range(normalizeCellAddress(value));
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureCellRef(sheet: XLSX.WorkSheet, range: XLSX.Range) {
  const currentRange = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : range;

  currentRange.s.r = Math.min(currentRange.s.r, range.s.r);
  currentRange.s.c = Math.min(currentRange.s.c, range.s.c);
  currentRange.e.r = Math.max(currentRange.e.r, range.e.r);
  currentRange.e.c = Math.max(currentRange.e.c, range.e.c);
  sheet["!ref"] = XLSX.utils.encode_range(currentRange);
}

function getCellAddresses(range: XLSX.Range) {
  const cellAddresses: string[] = [];

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      cellAddresses.push(XLSX.utils.encode_cell({ r: row, c: column }));
    }
  }

  return cellAddresses;
}

function formatAvailableWorksheetNames(sheetNames: string[]) {
  return sheetNames.length ? sheetNames.join(", ") : "none";
}

function resolveWorksheetName(sheetNames: string[], requestedSheetName?: string) {
  const requested = requestedSheetName?.trim();

  if (!requested) {
    return sheetNames[0] ?? "";
  }

  if (sheetNames.includes(requested)) {
    return requested;
  }

  const normalizedRequested = requested.toLowerCase();
  const caseInsensitiveMatch = sheetNames.find(
    (sheetName) => sheetName.trim().toLowerCase() === normalizedRequested
  );

  if (caseInsensitiveMatch) {
    return caseInsensitiveMatch;
  }

  if (sheetNames.length === 1) {
    return sheetNames[0];
  }

  throw new Error(
    `Worksheet "${requested}" was not found. Available worksheets: ${formatAvailableWorksheetNames(sheetNames)}.`
  );
}

type WorkbookCellInputValue = string | number | boolean | null;

function coerceCellValue(value: WorkbookCellInputValue) {
  if (typeof value === "boolean") {
    return { t: "b", v: value };
  }

  if (typeof value === "number") {
    return { t: "n", v: Number.isFinite(value) ? value : 0 };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);

    if (trimmed !== "" && Number.isFinite(numeric)) {
      return { t: "n", v: numeric };
    }

    return { t: "s", v: value };
  }

  return { t: "s", v: "" };
}

function isPercentFormattedCell(cell: XLSX.CellObject | undefined) {
  return typeof cell?.z === "string" && cell.z.includes("%");
}

function normalizeCellInputValue(
  value: WorkbookCellInputValue,
  existingCell: XLSX.CellObject | undefined
): WorkbookCellInputValue {
  if (!isPercentFormattedCell(existingCell)) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) > 1 ? value / 100 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);

    if (trimmed !== "" && Number.isFinite(numeric)) {
      return Math.abs(numeric) > 1 ? numeric / 100 : numeric;
    }
  }

  return value;
}

function serializeCellValue(cellAddress: string, value: WorkbookCellInputValue, existingCell = "") {
  const styleMatch = existingCell.match(/\ss="[^"]*"/);
  const styleAttribute = styleMatch?.[0] ?? "";

  if (typeof value === "boolean") {
    return `<c r="${cellAddress}"${styleAttribute} t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  if (typeof value === "number") {
    return `<c r="${cellAddress}"${styleAttribute}><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);

    if (trimmed !== "" && Number.isFinite(numeric)) {
      return `<c r="${cellAddress}"${styleAttribute}><v>${numeric}</v></c>`;
    }

    return `<c r="${cellAddress}"${styleAttribute} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  }

  return `<c r="${cellAddress}"${styleAttribute} t="inlineStr"><is><t></t></is></c>`;
}

function getRowNumber(cellAddress: string) {
  return Number(cellAddress.match(/\d+/)?.[0] ?? 0);
}

function compareCellAddresses(left: string, right: string) {
  const leftCell = XLSX.utils.decode_cell(left);
  const rightCell = XLSX.utils.decode_cell(right);

  if (leftCell.r !== rightCell.r) {
    return leftCell.r - rightCell.r;
  }

  return leftCell.c - rightCell.c;
}

function patchCellInRow(rowXml: string, cellAddress: string, value: WorkbookCellInputValue) {
  const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${cellAddress}")[^>]*?(?:\\s*\\/>|>[\\s\\S]*?<\\/c>)`);
  const existingCell = rowXml.match(cellPattern)?.[0] ?? "";
  const nextCell = serializeCellValue(cellAddress, value, existingCell);

  if (existingCell) {
    return rowXml.replace(cellPattern, nextCell);
  }

  const existingCells = Array.from(rowXml.matchAll(/<c\b(?=[^>]*\br="([^"]+)")[^>]*?(?:\s*\/>|>[\s\S]*?<\/c>)/g));
  const insertBefore = existingCells.find((match) => compareCellAddresses(cellAddress, match[1]) < 0);

  if (insertBefore?.index !== undefined) {
    return `${rowXml.slice(0, insertBefore.index)}${nextCell}${rowXml.slice(insertBefore.index)}`;
  }

  return rowXml.replace("</row>", `${nextCell}</row>`);
}

function patchSheetCell(sheetXml: string, cellAddress: string, value: WorkbookCellInputValue) {
  const rowNumber = getRowNumber(cellAddress);
  const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*?(?:\\s*\\/>|>[\\s\\S]*?<\\/row>)`);
  const existingRow = sheetXml.match(rowPattern)?.[0] ?? "";

  if (existingRow) {
    const normalizedRow = existingRow.endsWith("/>")
      ? existingRow.replace(/\s*\/>$/, `></row>`)
      : existingRow;
    return sheetXml.replace(rowPattern, patchCellInRow(normalizedRow, cellAddress, value));
  }

  const nextCell = serializeCellValue(cellAddress, value);
  const nextRow = `<row r="${rowNumber}">${nextCell}</row>`;
  const existingRows = Array.from(sheetXml.matchAll(/<row\b(?=[^>]*\br="(\d+)")[^>]*?(?:\s*\/>|>[\s\S]*?<\/row>)/g));
  const insertBefore = existingRows.find((match) => rowNumber < Number(match[1]));

  if (insertBefore?.index !== undefined) {
    return `${sheetXml.slice(0, insertBefore.index)}${nextRow}${sheetXml.slice(insertBefore.index)}`;
  }

  if (sheetXml.includes("</sheetData>")) {
    return sheetXml.replace("</sheetData>", `${nextRow}</sheetData>`);
  }

  return sheetXml.replace(/<worksheet\b[^>]*>/, (match) => `${match}<sheetData>${nextRow}</sheetData>`);
}

function normalizeSheetTarget(target: string) {
  const normalized = target.replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function getAttribute(xml: string, name: string) {
  return xml.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
}

function patchWorkbookCalculationProperties(workbookXml: string) {
  const calcPr = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';

  if (/<calcPr\b[^>]*(?:\/>|>[\s\S]*?<\/calcPr>)/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b[^>]*(?:\/>|>[\s\S]*?<\/calcPr>)/, calcPr);
  }

  return workbookXml.replace("</workbook>", `${calcPr}</workbook>`);
}

function removeCalculationChainContentType(contentTypesXml: string) {
  return contentTypesXml.replace(
    /<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/,
    ""
  );
}

function removeCalculationChainRelationship(relationshipsXml: string) {
  return relationshipsXml.replace(
    /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/calcChain"[^>]*\/>/,
    ""
  );
}

async function getSheetTargets(zip: JSZip) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const relationshipsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");

  if (!workbookXml || !relationshipsXml) {
    return [];
  }

  const relTargets = new Map<string, string>();

  for (const relationship of relationshipsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const relationshipXml = relationship[0];
    const id = getAttribute(relationshipXml, "Id");
    const target = getAttribute(relationshipXml, "Target");

    if (id && target) {
      relTargets.set(id, normalizeSheetTarget(target));
    }
  }

  const sheetTargets: SheetTarget[] = [];

  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const sheetXml = sheet[0];
    const name = getAttribute(sheetXml, "name");
    const relationId = getAttribute(sheetXml, "r:id");
    const path = relationId ? relTargets.get(relationId) : "";

    if (name && path) {
      sheetTargets.push({ name, path });
    }
  }

  return sheetTargets;
}

async function patchWorkbookBuffer(input: {
  buffer: Buffer;
  workbook: XLSX.WorkBook;
  inputs: WorkbookRunInputMapping[];
}) {
  const zip = await JSZip.loadAsync(input.buffer);
  const sheetTargets = await getSheetTargets(zip);
  const sheetPathByName = new Map(sheetTargets.map((sheet) => [sheet.name, sheet.path]));
  const sheetTargetNames = sheetTargets.map((sheet) => sheet.name);
  const sheetXmlByPath = new Map<string, string>();

  for (const runInput of input.inputs) {
    if (!runInput.cell.trim()) {
      continue;
    }

    const sheetName = resolveWorksheetName(sheetTargetNames, runInput.sheetName);
    const sheetPath = sheetPathByName.get(sheetName);

    if (!sheetPath) {
      throw new Error(
        `Worksheet "${sheetName}" was not found. Available worksheets: ${formatAvailableWorksheetNames(sheetTargetNames)}.`
      );
    }

    let sheetXml =
      sheetXmlByPath.get(sheetPath) ?? (await zip.file(sheetPath)?.async("text"));

    if (!sheetXml) {
      throw new Error(`Worksheet file not found: ${sheetName}`);
    }

    const inputValues = getInputValues(runInput.value);

    for (const [index, cellAddress] of getCellAddresses(normalizeCellRange(runInput.cell)).entries()) {
      if (index >= inputValues.length) {
        break;
      }

      sheetXml = patchSheetCell(sheetXml, cellAddress, inputValues[index]);
    }

    sheetXmlByPath.set(sheetPath, sheetXml);
  }

  for (const [sheetPath, sheetXml] of sheetXmlByPath) {
    zip.file(sheetPath, sheetXml);
  }

  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");

  if (workbookXml) {
    zip.file("xl/workbook.xml", patchWorkbookCalculationProperties(workbookXml));
  }

  zip.remove("xl/calcChain.xml");

  const contentTypesXml = await zip.file("[Content_Types].xml")?.async("text");

  if (contentTypesXml) {
    zip.file("[Content_Types].xml", removeCalculationChainContentType(contentTypesXml));
  }

  const workbookRelationshipsXml = await zip
    .file("xl/_rels/workbook.xml.rels")
    ?.async("text");

  if (workbookRelationshipsXml) {
    zip.file(
      "xl/_rels/workbook.xml.rels",
      removeCalculationChainRelationship(workbookRelationshipsXml)
    );
  }

  return zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
  });
}

function getSheet(workbook: XLSX.WorkBook, sheetName?: string) {
  const resolvedSheetName = resolveWorksheetName(workbook.SheetNames, sheetName);
  const sheet = workbook.Sheets[resolvedSheetName];

  if (!sheet) {
    throw new Error(
      `Worksheet "${resolvedSheetName}" was not found. Available worksheets: ${formatAvailableWorksheetNames(workbook.SheetNames)}.`
    );
  }

  return { sheet, sheetName: resolvedSheetName };
}

function readDisplayValue(cell: XLSX.CellObject | undefined) {
  if (!cell) {
    return "";
  }

  if (cell.w !== undefined) {
    return String(cell.w);
  }

  if (cell.v !== undefined) {
    return String(cell.v);
  }

  return "";
}

function getWorkbookExtension(fileName: string) {
  return fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "xlsx";
}

function getCompletedWorkbookName(fileName: string) {
  const extension = getWorkbookExtension(fileName);
  return fileName.replace(/\.(xlsx|xlsm|xls)$/i, `-completed.${extension}`);
}

function writeLegacyWorkbook(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, {
    type: "base64",
    bookType: "biff8",
    cellDates: true,
  });
}

async function findLibreOfficeExecutable() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    "libreoffice",
    "soffice",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

async function findPythonExecutable() {
  const candidates = [process.env.PYTHON_PATH, "python3", "python"].filter(
    Boolean
  ) as string[];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

const libreOfficeRecalculateScript = String.raw`
import json
import os
import re
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def property_value(name, value):
    prop = PropertyValue()
    prop.Name = name
    prop.Value = value
    return prop


def cell_position(cell_address):
    match = re.fullmatch(r"([A-Z]+)([0-9]+)", cell_address.upper())
    if match is None:
        raise RuntimeError(f"Invalid cell address: {cell_address}")

    column = 0
    for character in match.group(1):
        column = column * 26 + ord(character) - 64

    return column - 1, int(match.group(2)) - 1


def set_cell_value(sheet, cell_address, value):
    column, row = cell_position(cell_address)
    cell = sheet.getCellByPosition(column, row)

    if value is None:
        cell.setString("")
    elif isinstance(value, bool):
        cell.setValue(1 if value else 0)
    elif isinstance(value, (int, float)):
        cell.setValue(float(value))
    else:
        cell.setString(str(value))


def connect_to_office(port):
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver",
        local_context,
    )
    url = (
        "uno:socket,host=127.0.0.1,port="
        + str(port)
        + ";urp;StarOffice.ComponentContext"
    )

    last_error = None
    for _ in range(120):
        try:
            return resolver.resolve(url)
        except Exception as error:
            last_error = error
            time.sleep(0.25)

    raise RuntimeError(f"Unable to connect to LibreOffice: {last_error}")


def main():
    soffice, input_path, output_path, profile_dir, filter_name, patches_path = sys.argv[1:7]
    port = str(20_000 + (os.getpid() % 20_000))
    profile_url = uno.systemPathToFileUrl(profile_dir)
    process = subprocess.Popen(
        [
            soffice,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--norestore",
            "--accept=socket,host=127.0.0.1,port=" + port + ";urp;StarOffice.ServiceManager",
            "-env:UserInstallation=" + profile_url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    document = None
    desktop = None

    try:
        context = connect_to_office(port)
        service_manager = context.ServiceManager
        desktop = service_manager.createInstanceWithContext(
            "com.sun.star.frame.Desktop",
            context,
        )
        document = desktop.loadComponentFromURL(
            uno.systemPathToFileUrl(input_path),
            "_blank",
            0,
            (
                property_value("Hidden", True),
                property_value("ReadOnly", False),
                property_value("UpdateDocMode", 3),
            ),
        )

        if document is None:
            raise RuntimeError("LibreOffice could not open the workbook.")

        with open(patches_path, "r", encoding="utf-8") as patches_file:
            patches = json.load(patches_file)

        sheets = document.getSheets()

        for patch in patches:
            sheet = sheets.getByName(patch["sheetName"])
            set_cell_value(sheet, patch["cell"], patch.get("value"))

        if hasattr(document, "enableAutomaticCalculation"):
            document.enableAutomaticCalculation(True)
        document.calculateAll()
        document.calculateAll()
        document.storeAsURL(
            uno.systemPathToFileUrl(output_path),
            (property_value("FilterName", filter_name),),
        )
    finally:
        if document is not None:
            document.close(True)
        if desktop is not None:
            desktop.terminate()
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    main()
`;

async function recalculateWithLibreOfficeUno(input: {
  executable: string;
  base64Workbook: string;
  extension: string;
  filterName: string;
  patches: WorkbookCellPatch[];
  inputDir: string;
  outputDir: string;
  profileDir: string;
  tempRoot: string;
}) {
  const pythonExecutable = await findPythonExecutable();

  if (!pythonExecutable) {
    return null;
  }

  const inputPath = path.join(input.inputDir, `workbook.${input.extension}`);
  const outputPath = path.join(input.outputDir, `workbook.${input.extension}`);
  const scriptPath = path.join(input.tempRoot, "recalculate.py");
  const patchesPath = path.join(input.tempRoot, "patches.json");

  await writeFile(inputPath, Buffer.from(input.base64Workbook, "base64"));
  await writeFile(scriptPath, libreOfficeRecalculateScript);
  await writeFile(patchesPath, JSON.stringify(input.patches));
  await execFileAsync(
    pythonExecutable,
    [
      scriptPath,
      input.executable,
      inputPath,
      outputPath,
      input.profileDir,
      input.filterName,
      patchesPath,
    ],
    120_000
  );

  return readFile(outputPath);
}

function getLibreOfficeFilterName(extension: string) {
  if (extension === "xls") {
    return "MS Excel 97";
  }

  if (extension === "xlsm") {
    return "Calc MS Excel 2007 VBA XML";
  }

  return "Calc MS Excel 2007 XML";
}

async function recalculateWorkbook(input: {
  base64Workbook: string;
  fallbackBase64Workbook: string;
  extension: string;
  patches: WorkbookCellPatch[];
}) {
  const executable = await findLibreOfficeExecutable();

  if (!executable) {
    return {
      base64: input.fallbackBase64Workbook,
      recalculated: false,
      message:
        "Inputs were written and the workbook was marked for full recalculation. Install LibreOffice on the server, or open the file in Excel and enable editing so Excel can recalculate formulas.",
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workbook-recalc-"));
  const inputDir = path.join(tempRoot, "input");
  const outputDir = path.join(tempRoot, "output");
  const profileDir = path.join(tempRoot, "profile");
  const safeExtension =
    input.extension === "xls" || input.extension === "xlsm" ? input.extension : "xlsx";
  const filterName = getLibreOfficeFilterName(safeExtension);
  const inputPath = path.join(inputDir, `workbook.${safeExtension}`);
  const outputPath = path.join(outputDir, `workbook.${safeExtension}`);

  try {
    await Promise.all([mkdir(inputDir), mkdir(outputDir), mkdir(profileDir)]);
    const unoRecalculatedWorkbook = await recalculateWithLibreOfficeUno({
      executable,
      base64Workbook: input.base64Workbook,
      extension: safeExtension,
      filterName,
      patches: input.patches,
      inputDir,
      outputDir,
      profileDir,
      tempRoot,
    }).catch(() => null);

    if (unoRecalculatedWorkbook) {
      return {
        base64: unoRecalculatedWorkbook.toString("base64"),
        recalculated: true,
        message:
          "Inputs were written and LibreOffice recalculated the workbook before download.",
      };
    }

    await writeFile(inputPath, Buffer.from(input.fallbackBase64Workbook, "base64"));
    await execFileAsync(executable, [
      "--headless",
      "--convert-to",
      safeExtension,
      "--outdir",
      outputDir,
      `-env:UserInstallation=file://${profileDir}`,
      inputPath,
    ]);

    const recalculatedWorkbook = await readFile(outputPath);

    return {
      base64: recalculatedWorkbook.toString("base64"),
      recalculated: true,
      message:
        "Inputs were written and LibreOffice recalculated the workbook before download.",
    };
  } catch {
    return {
      base64: input.fallbackBase64Workbook,
      recalculated: false,
      message:
        "Inputs were written and the workbook was marked for full recalculation, but server-side LibreOffice recalculation failed. Open the file in Excel and enable editing so Excel can recalculate formulas.",
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function getInputValues(value: WorkbookRunInputMapping["value"]) {
  return Array.isArray(value) ? value : [value];
}

function getWorkbookInputGroupCount(inputs: WorkbookRunInputMapping[]) {
  return Math.max(1, ...inputs.map((input) => getInputValues(input.value).length));
}

function readWorkbookOutputs(
  workbook: XLSX.WorkBook,
  outputs: WorkbookOutputMapping[],
  inputGroupCount: number
) {
  return outputs.flatMap((output) => {
    const { sheet, sheetName } = getSheet(workbook, output.sheetName);
    const cellRange = normalizeCellRange(output.cell);
    const cellAddresses = getCellAddresses(cellRange).slice(0, inputGroupCount);

    return cellAddresses.map((cellAddress, index) => {
      const cell = sheet[cellAddress];
      const isRangeOutput = cellAddresses.length > 1;

      return {
        key: isRangeOutput ? `${output.key}_${index + 1}` : output.key,
        label: isRangeOutput ? `${output.label} ${index + 1}` : output.label,
        cell: cellAddress,
        sheetName,
        value: cell?.v ?? null,
        displayValue: readDisplayValue(cell),
        formula: cell?.f ?? null,
      };
    });
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const workbookFile = formData.get("workbook");

    if (!(workbookFile instanceof File)) {
      return NextResponse.json({ error: "Workbook file is required." }, { status: 400 });
    }

    if (!/\.(xlsx|xlsm|xls)$/i.test(workbookFile.name)) {
      return NextResponse.json(
        { error: "Use an .xlsx, .xlsm, or .xls workbook." },
        { status: 400 }
      );
    }

    const inputs = parseJsonField<WorkbookRunInputMapping[]>(
      formData.get("inputs"),
      []
    );
    const outputs = parseJsonField<WorkbookOutputMapping[]>(
      formData.get("outputs"),
      []
    );

    if (outputs.length === 0) {
      return NextResponse.json(
        { error: "At least one output cell mapping is required." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await workbookFile.arrayBuffer());
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
    });
    const patchedInputs: WorkbookRunInputMapping[] = [];
    const cellPatches: WorkbookCellPatch[] = [];
    const inputGroupCount = getWorkbookInputGroupCount(inputs);

    for (const input of inputs) {
      if (!input.cell.trim()) {
        patchedInputs.push(input);
        continue;
      }

      const { sheet, sheetName } = getSheet(workbook, input.sheetName);
      const cellRange = normalizeCellRange(input.cell);
      ensureCellRef(sheet, cellRange);

      const inputValues = getInputValues(input.value);
      const patchedValues: WorkbookCellInputValue[] = [];

      for (const [index, cellAddress] of getCellAddresses(cellRange).entries()) {
        if (index >= inputValues.length) {
          break;
        }

        const normalizedValue = normalizeCellInputValue(
          inputValues[index],
          sheet[cellAddress]
        );
        patchedValues.push(normalizedValue);
        cellPatches.push({
          sheetName,
          cell: cellAddress,
          value: normalizedValue,
        });
        sheet[cellAddress] = coerceCellValue(normalizedValue) as XLSX.CellObject;
      }

      patchedInputs.push({
        ...input,
        value: Array.isArray(input.value)
          ? patchedValues
          : patchedValues[0] ?? null,
      });
    }

    const workbookExtension = getWorkbookExtension(workbookFile.name);
    const patchedWorkbook =
      workbookExtension === "xls"
        ? writeLegacyWorkbook(workbook)
        : await patchWorkbookBuffer({
            buffer,
            workbook,
            inputs: patchedInputs,
          });
    const recalculationResult = await recalculateWorkbook(
      {
        base64Workbook: buffer.toString("base64"),
        fallbackBase64Workbook: patchedWorkbook,
        extension: workbookExtension,
        patches: cellPatches,
      }
    );
    const outputWorkbook = recalculationResult.recalculated
      ? XLSX.read(Buffer.from(recalculationResult.base64, "base64"), {
          type: "buffer",
          cellDates: true,
          cellFormula: true,
          cellNF: true,
          cellStyles: true,
        })
      : workbook;
    const resultValues = readWorkbookOutputs(outputWorkbook, outputs, inputGroupCount);

    return NextResponse.json({
      outputs: resultValues,
      completedWorkbook: recalculationResult.base64,
      completedWorkbookName: getCompletedWorkbookName(workbookFile.name),
      recalc: {
        status:
          recalculationResult.recalculated
            ? "server_recalculated"
            : workbookExtension === "xls"
            ? "legacy_xls_written"
            : "pending_excel_recalc",
        message: recalculationResult.message,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run workbook template.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
