"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import type { BootstrapPayload } from "@/lib/types";
import {
  base64ToFile,
  createId,
  createInputKey,
  deleteSavedRunResultsForTemplate,
  extractWorkbookMetadata,
  fileToBase64,
  getAllTemplateInputLabels,
  getDropdownOptionsForRange,
  normalizeWorkbookInputKind,
  readPersistedWorkbookWorkspace,
  shiftCellRange,
  toKey,
  writePersistedWorkbookWorkspace,
  type WorkbookDropdownRule,
  type WorkbookWorkspaceData,
} from "@/lib/workbook-template-client";
import type {
  SavedWorkbookTemplate,
  WorkbookInputKind,
  WorkbookInputMapping,
  WorkbookOutputMapping,
} from "@/lib/workbook-template-types";

type LendersWorkspaceProps = {
  initialData: BootstrapPayload;
};

const inputKinds: WorkbookInputKind[] = ["number", "text", "select", "boolean"];

function createInput(index: number): WorkbookInputMapping {
  const label = `Input ${index}`;

  return {
    id: createId("input"),
    key: createInputKey(label),
    label,
    kind: "number",
    sheetName: "",
    cell: "",
  };
}

function createOutput(index: number): WorkbookOutputMapping {
  const label = `Output ${index}`;

  return {
    id: createId("output"),
    key: label,
    label,
    sheetName: "",
    cell: "",
  };
}

function createDefaultInputs() {
  return [
    {
      id: createId("input"),
      key: createInputKey("Monthly rent"),
      label: "Monthly rent",
      kind: "number",
      sheetName: "",
      cell: "",
    },
    {
      id: createId("input"),
      key: createInputKey("Property tax"),
      label: "Property tax",
      kind: "number",
      sheetName: "",
      cell: "",
    },
  ] satisfies WorkbookInputMapping[];
}

function createDefaultOutputs() {
  return [
    {
      id: createId("output"),
      key: "Surplus / shortfall",
      label: "Surplus / shortfall",
      sheetName: "",
      cell: "",
    },
  ] satisfies WorkbookOutputMapping[];
}

export function LendersWorkspace(props: LendersWorkspaceProps) {
  void props.initialData;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [savedWorkbookFileName, setSavedWorkbookFileName] = useState("");
  const [savedWorkbookBase64, setSavedWorkbookBase64] = useState("");
  const [templateName, setTemplateName] = useState("New lender worksheet");
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [defaultSheetName, setDefaultSheetName] = useState("");
  const [dropdownRules, setDropdownRules] = useState<WorkbookDropdownRule[]>([]);
  const [inputs, setInputs] = useState<WorkbookInputMapping[]>(createDefaultInputs);
  const [outputs, setOutputs] = useState<WorkbookOutputMapping[]>(createDefaultOutputs);
  const [savedTemplates, setSavedTemplates] = useState<SavedWorkbookTemplate[]>([]);
  const [workspace, setWorkspace] = useState<WorkbookWorkspaceData>({
    templates: [],
    clients: [],
    runResults: [],
  });
  const [message, setMessage] = useState<string | null>(null);
  const [isDraggingWorkbook, setIsDraggingWorkbook] = useState(false);

  useEffect(() => {
    let isMounted = true;

    readPersistedWorkbookWorkspace().then((savedWorkspace) => {
      if (!isMounted) {
        return;
      }

      setWorkspace(savedWorkspace);
      setSavedTemplates(savedWorkspace.templates);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const mappedInputCount = inputs.filter((input) => input.cell.trim()).length;
  const mappedOutputCount = outputs.filter((output) => output.cell.trim()).length;
  const inputLabelSuggestions = getAllTemplateInputLabels(savedTemplates);

  const updateInput = (id: string, nextValue: Partial<WorkbookInputMapping>) => {
    setInputs((current) =>
      current.map((input) => (input.id === id ? { ...input, ...nextValue } : input))
    );
  };

  const getInputOptions = (sheetName: string, cell: string) =>
    getDropdownOptionsForRange(dropdownRules, sheetName || defaultSheetName, cell);

  const getInputOptionsFromRules = (
    rules: WorkbookDropdownRule[],
    sheetName: string,
    cell: string
  ) => getDropdownOptionsForRange(rules, sheetName || defaultSheetName, cell);

  const updateInputCell = (
    input: WorkbookInputMapping,
    nextValue: Partial<Pick<WorkbookInputMapping, "sheetName" | "cell">>
  ) => {
    const nextSheetName = nextValue.sheetName ?? input.sheetName ?? defaultSheetName;
    const nextCell = nextValue.cell ?? input.cell;
    const options = getInputOptions(nextSheetName, nextCell);

    updateInput(input.id, {
      ...nextValue,
      options,
      kind: options.length ? "select" : input.kind === "select" ? "text" : input.kind,
    });
  };

  const updateOutput = (id: string, nextValue: Partial<WorkbookOutputMapping>) => {
    setOutputs((current) =>
      current.map((output) => (output.id === id ? { ...output, ...nextValue } : output))
    );
  };

  const applyDefaultSheet = (sheetName: string) => {
    setDefaultSheetName(sheetName);
    setInputs((current) =>
      current.map((input) => ({
        ...input,
        sheetName: input.sheetName || sheetName,
      }))
    );
    setOutputs((current) =>
      current.map((output) => ({
        ...output,
        sheetName: output.sheetName || sheetName,
      }))
    );
  };

  const addInputFrom = (sourceInput: WorkbookInputMapping, direction: "right" | "down") => {
    const label = `Input ${inputs.length + 1}`;
    const nextInput: WorkbookInputMapping = {
      ...sourceInput,
      id: createId("input"),
      key: createInputKey(label),
      label,
      sheetName: sourceInput.sheetName || defaultSheetName,
      cell: shiftCellRange(sourceInput.cell, direction),
    };
    const options = getInputOptions(nextInput.sheetName, nextInput.cell);
    nextInput.options = options;
    nextInput.kind = options.length ? "select" : nextInput.kind === "select" ? "text" : nextInput.kind;
    const sourceIndex = inputs.findIndex((input) => input.id === sourceInput.id);

    setInputs((current) => [
      ...current.slice(0, sourceIndex + 1),
      nextInput,
      ...current.slice(sourceIndex + 1),
    ]);
  };

  const rejectSave = (errorMessage: string) => {
    setMessage(errorMessage);
    toast.error("Template not saved", {
      description: errorMessage,
    });
  };

  const applyWorkbookFile = async (file: File | null) => {
    setWorkbookFile(file);

    if (!file) {
      return;
    }

    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      toast.error("Workbook not loaded", {
        description: "Drop or select an .xlsx, .xlsm, or .xls workbook.",
      });
      setWorkbookFile(null);
      return;
    }

    try {
      setSavedWorkbookFileName("");
      setSavedWorkbookBase64("");
      if (!editingTemplateId) {
        setTemplateName(file.name.replace(/\.(xlsx|xlsm|xls)$/i, ""));
      }
      const metadata = await extractWorkbookMetadata(file);
      setSheetNames(metadata.sheetNames);
      setDropdownRules(metadata.dropdownRules);
      const firstSheetName = metadata.sheetNames[0] ?? "";
      applyDefaultSheet(firstSheetName);
      setInputs((current) =>
        current.map((input) => {
          const nextSheetName = input.sheetName || firstSheetName;
          const options = getInputOptionsFromRules(
            metadata.dropdownRules,
            nextSheetName,
            input.cell
          );

          return {
            ...input,
            sheetName: nextSheetName,
            options,
            kind: options.length
              ? "select"
              : input.kind === "select"
                ? "text"
                : input.kind,
          };
        })
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to read workbook metadata.";
      setWorkbookFile(null);
      toast.error("Workbook not loaded", {
        description: errorMessage,
      });
    }
  };

  const handleWorkbookDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingWorkbook(false);
    await applyWorkbookFile(event.dataTransfer.files[0] ?? null);
  };

  const openNewTemplate = () => {
    setIsTemplateOpen(true);
    setEditingTemplateId(null);
    setSavedWorkbookFileName("");
    setSavedWorkbookBase64("");
    setTemplateName("New lender worksheet");
    setWorkbookFile(null);
    setSheetNames([]);
    setDefaultSheetName("");
    setDropdownRules([]);
    setInputs(createDefaultInputs());
    setOutputs(createDefaultOutputs());
    setMessage(null);
  };

  const saveTemplate = async () => {
    if (!workbookFile && !savedWorkbookBase64) {
      rejectSave("Upload an Excel workbook before saving the template.");
      return;
    }

    if (!templateName.trim()) {
      rejectSave("Enter a lender or template name before saving.");
      return;
    }

    if (inputs.some((input) => !input.key.trim() || !input.cell.trim())) {
      rejectSave("Every input needs a key and workbook cell.");
      return;
    }

    if (outputs.some((output) => !output.key.trim() || !output.cell.trim())) {
      rejectSave("Every output needs a key and workbook cell.");
      return;
    }

    try {
      const existingTemplate = savedTemplates.find(
        (template) =>
          template.id === editingTemplateId ||
          template.name.toLowerCase() === templateName.trim().toLowerCase()
      );
      const normalizedInputs = inputs.map((input) => ({
        ...input,
        key: input.key || createInputKey(input.label),
        kind: normalizeWorkbookInputKind(input.kind),
      }));
      const normalizedOutputs = outputs.map((output) => ({
        ...output,
        key: toKey(output.label),
      }));
      const nextTemplate: SavedWorkbookTemplate = {
        id: existingTemplate?.id ?? createId("template"),
        name: templateName.trim(),
        fileName: workbookFile?.name ?? savedWorkbookFileName,
        fileBase64: workbookFile ? await fileToBase64(workbookFile) : savedWorkbookBase64,
        sheetNames,
        defaultSheetName: defaultSheetName || sheetNames[0] || "",
        inputs: normalizedInputs,
        outputs: normalizedOutputs,
        updatedAt: new Date().toISOString(),
      };
      const nextTemplates = [
        nextTemplate,
        ...savedTemplates.filter((template) => template.id !== nextTemplate.id),
      ];
      const nextWorkspace = {
        ...workspace,
        templates: nextTemplates,
        runResults: workspace.runResults.filter(
          (result) => result.templateId !== nextTemplate.id
        ),
      };

      await writePersistedWorkbookWorkspace(nextWorkspace);
      deleteSavedRunResultsForTemplate(nextTemplate.id);
      setWorkspace(nextWorkspace);
      setSavedTemplates(nextTemplates);
      setEditingTemplateId(nextTemplate.id);
      setSavedWorkbookFileName(nextTemplate.fileName);
      setSavedWorkbookBase64(nextTemplate.fileBase64);
      setWorkbookFile(null);
      setMessage(`Saved ${nextTemplate.name}.`);
      toast.success("Template saved", {
        description: nextTemplate.name,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to save template.";
      setMessage(errorMessage);
      toast.error("Template not saved", {
        description: errorMessage,
      });
    }
  };

  const loadTemplate = async (template: SavedWorkbookTemplate) => {
    setIsTemplateOpen(true);
    setEditingTemplateId(template.id);
    setSavedWorkbookFileName(template.fileName);
    setSavedWorkbookBase64(template.fileBase64);
    setTemplateName(template.name);
    setWorkbookFile(null);
    const metadata = await extractWorkbookMetadata(
      base64ToFile(template.fileBase64, template.fileName)
    );
    const nextSheetNames = template.sheetNames?.length
      ? template.sheetNames
      : metadata.sheetNames;
    setSheetNames(nextSheetNames);
    setDefaultSheetName(template.defaultSheetName ?? nextSheetNames[0] ?? "");
    setDropdownRules(metadata.dropdownRules);
    setInputs(
      template.inputs.map((input) => ({
        ...input,
        kind: normalizeWorkbookInputKind(input.kind),
      }))
    );
    setOutputs(template.outputs);
    setMessage(`Loaded ${template.name}. Upload a workbook only if you want to replace the file.`);
  };

  const deleteTemplate = async (templateId: string) => {
    const nextTemplates = savedTemplates.filter((template) => template.id !== templateId);
    const nextWorkspace = {
      ...workspace,
      templates: nextTemplates,
      runResults: workspace.runResults.filter(
        (result) => result.templateId !== templateId
      ),
    };

    await writePersistedWorkbookWorkspace(nextWorkspace);
    deleteSavedRunResultsForTemplate(templateId);
    setWorkspace(nextWorkspace);
    setSavedTemplates(nextTemplates);
  };

  return (
    <AppShell
      title="Workbook template setup"
      eyebrow="Template Builder"
      description="Create reusable workbook templates by naming the lender or spreadsheet, uploading the Excel file, and mapping input and output cells once."
    >
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="glass-panel rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Saved Templates
            </p>
            <button
              type="button"
              onClick={openNewTemplate}
              className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Add new template
            </button>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {savedTemplates.length ? (
                savedTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-md border border-[var(--line)] bg-white/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{template.name}</p>
                        <p className="mt-1 truncate text-xs text-[var(--muted)]">
                          {template.fileName}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => loadTemplate(template)}
                          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTemplate(template.id)}
                          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      {template.inputs.length} inputs, {template.outputs.length} outputs
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-md border border-dashed border-[var(--line)] bg-white/60 p-4 text-sm leading-6 text-[var(--muted)]">
                  No saved workbook templates yet.
                </p>
              )}
            </div>
          </section>

          {isTemplateOpen ? (
            <section className="glass-panel rounded-lg p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Template
                </p>
                <h2 className="mt-2 text-xl font-semibold">Workbook setup</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
                >
                  Upload Excel
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls"
                className="hidden"
                onChange={async (event) => {
                  await applyWorkbookFile(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">Lender or template name</span>
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2"
                />
              </label>
              <section
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingWorkbook(true);
                }}
                onDragLeave={() => setIsDraggingWorkbook(false)}
                onDrop={handleWorkbookDrop}
                className={`rounded-md border border-dashed px-3 py-3 transition ${
                  isDraggingWorkbook
                    ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                    : "border-[var(--line)] bg-white"
                }`}
              >
                <p className="text-sm font-medium">Workbook file</p>
                <p className="mt-1 truncate text-sm text-[var(--muted)]">
                  {workbookFile?.name ?? (savedWorkbookFileName || "Drop Excel file here")}
                </p>
              </section>
            </div>
            </section>
          ) : null}

          {isTemplateOpen ? (
            <section className="glass-panel rounded-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Inputs
                </p>
                <h2 className="mt-2 text-xl font-semibold">Cells to fill</h2>
              </div>
              {inputs.length === 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setInputs((current) => [...current, createInput(current.length + 1)])
                  }
                  className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                >
                  Add first input
                </button>
              ) : null}
            </div>

            <div className="mt-5 space-y-3">
              <datalist id="workbook-input-label-suggestions">
                {inputLabelSuggestions.map((label) => (
                  <option key={label} value={label} />
                ))}
              </datalist>
              {inputs.map((input) => (
                <div
                  key={input.id}
                  className="grid gap-3 rounded-md border border-[var(--line)] bg-white/80 p-3 lg:grid-cols-[1fr_120px_150px_130px_220px]"
                >
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Label / Key</span>
                    <input
                      list="workbook-input-label-suggestions"
                      value={input.label}
                      onChange={(event) => {
                        const label = event.target.value;
                        updateInput(input.id, {
                          label,
                        });
                      }}
                      className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Type</span>
                    <select
                      value={input.kind}
                      onChange={(event) =>
                        updateInput(input.id, {
                          kind: event.target.value as WorkbookInputKind,
                        })
                      }
                      className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    >
                      {inputKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Sheet</span>
                    {sheetNames.length ? (
                      <select
                        value={input.sheetName || defaultSheetName}
                        onChange={(event) =>
                          updateInputCell(input, { sheetName: event.target.value })
                        }
                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      >
                        {sheetNames.map((sheetName) => (
                          <option key={sheetName} value={sheetName}>
                            {sheetName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={input.sheetName}
                        onChange={(event) =>
                          updateInputCell(input, { sheetName: event.target.value })
                        }
                        placeholder="first sheet"
                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      />
                    )}
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Cell / Range</span>
                    <input
                      value={input.cell}
                      onChange={(event) =>
                        updateInputCell(input, {
                          cell: event.target.value.toUpperCase(),
                        })
                      }
                      placeholder="B12 or C8:C17"
                      className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 self-end">
                    <button
                      type="button"
                      onClick={() => addInputFrom(input, "right")}
                      className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    >
                      Add right
                    </button>
                    <button
                      type="button"
                      onClick={() => addInputFrom(input, "down")}
                      className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    >
                      Add down
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setInputs((current) =>
                          current.length === 1
                            ? current
                            : current.filter((item) => item.id !== input.id)
                        )
                      }
                      className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                  {input.options?.length ? (
                    <div className="lg:col-span-5 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--muted)]">
                      {input.options.length} selection option
                      {input.options.length === 1 ? "" : "s"} detected
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            </section>
          ) : null}

          {isTemplateOpen ? (
            <section className="glass-panel rounded-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Outputs
                </p>
                <h2 className="mt-2 text-xl font-semibold">Cells to read</h2>
              </div>
              <button
                type="button"
                onClick={() =>
                  setOutputs((current) => [...current, createOutput(current.length + 1)])
                }
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
              >
                Add output
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {outputs.map((output) => (
                <div
                  key={output.id}
                  className="grid gap-3 rounded-md border border-[var(--line)] bg-white/80 p-3 lg:grid-cols-[1fr_150px_130px_auto]"
                >
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Label / Key</span>
                    <input
                      value={output.label}
                      onChange={(event) => {
                        const label = event.target.value;
                        updateOutput(output.id, {
                          label,
                          key: toKey(label),
                        });
                      }}
                      className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Sheet</span>
                    {sheetNames.length ? (
                      <select
                        value={output.sheetName || defaultSheetName}
                        onChange={(event) =>
                          updateOutput(output.id, { sheetName: event.target.value })
                        }
                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      >
                        {sheetNames.map((sheetName) => (
                          <option key={sheetName} value={sheetName}>
                            {sheetName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={output.sheetName}
                        onChange={(event) =>
                          updateOutput(output.id, { sheetName: event.target.value })
                        }
                        placeholder="first sheet"
                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      />
                    )}
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--muted)]">Cell / Range</span>
                    <input
                      value={output.cell}
                      onChange={(event) =>
                        updateOutput(output.id, { cell: event.target.value.toUpperCase() })
                      }
                      placeholder="H35 or H35:H38"
                      className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setOutputs((current) =>
                        current.length === 1
                          ? current
                          : current.filter((item) => item.id !== output.id)
                      )
                    }
                    className="self-end rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            </section>
          ) : null}

          {isTemplateOpen ? (
            <section className="glass-panel rounded-lg p-6">
            <button
              type="button"
              onClick={saveTemplate}
              className="w-full rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white"
            >
              Save template
            </button>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section className="glass-panel rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Mapping Status
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">{mappedInputCount}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">inputs</p>
              </div>
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">{mappedOutputCount}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">outputs</p>
              </div>
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">{savedTemplates.length}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">saved</p>
              </div>
            </div>
          </section>

          {message ? (
            <section className="glass-panel rounded-lg p-4 text-sm leading-6">
              {message}
            </section>
          ) : null}
        </aside>
      </section>
    </AppShell>
  );
}
