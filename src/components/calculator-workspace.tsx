"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import type { BootstrapPayload } from "@/lib/types";
import {
  base64ToFile,
  createId,
  downloadBase64Workbook,
  getInputType,
  getTemplateInputCatalog,
  normalizeClientValue,
  normalizeClientValueList,
  readPersistedWorkbookWorkspace,
  runWorkbookTemplate,
  writePersistedWorkbookWorkspace,
  type WorkbookWorkspaceData,
} from "@/lib/workbook-template-client";
import type {
  SavedWorkbookTemplate,
  WorkbookClientFile,
  WorkbookDashboardRunResult,
  WorkbookInputMapping,
  SavedWorkbookRunResult,
} from "@/lib/workbook-template-types";

type CalculatorWorkspaceProps = {
  initialData: BootstrapPayload;
};

function createClient(index: number, inputs: WorkbookInputMapping[]): WorkbookClientFile {
  return {
    id: createId("client"),
    name: `Client ${index}`,
    values: Object.fromEntries(inputs.map((input) => [input.label, ""])),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeClient(
  client: WorkbookClientFile,
  inputs: WorkbookInputMapping[]
): WorkbookClientFile {
  return {
    ...client,
    values: Object.fromEntries(
      inputs.map((input) => [
        input.label,
        client.values[input.label] ?? client.values[input.key] ?? "",
      ])
    ),
  };
}

function formatOutputValue(value: string | number | boolean | null, displayValue: string) {
  if (displayValue) {
    return displayValue;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value === null ? "" : String(value);
}

function getClientUnitCount(
  client: WorkbookClientFile | null,
  inputs: WorkbookInputMapping[]
) {
  if (!client || inputs.length === 0) {
    return 1;
  }

  return Math.max(
    1,
    ...inputs.map(
      (input) => normalizeClientValueList(client.values[input.label]).length
    )
  );
}

function resizeValues(values: string[], nextLength: number) {
  if (values.length >= nextLength) {
    return values.slice(0, nextLength);
  }

  return [...values, ...Array.from({ length: nextLength - values.length }, () => "")];
}

function getSavedResultsForClient(
  clientId: string,
  templateIds: string[],
  runResults: SavedWorkbookRunResult[]
): WorkbookDashboardRunResult[] {
  if (!clientId) {
    return [];
  }

  const selectedTemplateIds = new Set(templateIds);

  return runResults
    .filter(
      (result) =>
        result.clientId === clientId && selectedTemplateIds.has(result.templateId)
    )
    .sort((left, right) => templateIds.indexOf(left.templateId) - templateIds.indexOf(right.templateId))
    .map((result) => ({
      templateId: result.templateId,
      templateName: result.templateName,
      response: result.response,
    }));
}

export function CalculatorWorkspace({ initialData }: CalculatorWorkspaceProps) {
  const [templates, setTemplates] = useState<SavedWorkbookTemplate[]>([]);
  const [workspace, setWorkspace] = useState<WorkbookWorkspaceData>({
    templates: [],
    clients: [],
    runResults: [],
  });
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [clients, setClients] = useState<WorkbookClientFile[]>([]);
  const [activeClientId, setActiveClientId] = useState("");
  const [openUnitKeys, setOpenUnitKeys] = useState<Record<string, boolean>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dashboardResults, setDashboardResults] = useState<WorkbookDashboardRunResult[]>([]);

  useEffect(() => {
    let isMounted = true;

    readPersistedWorkbookWorkspace().then((savedWorkspace) => {
      if (!isMounted) {
        return;
      }

      const inputCatalog = getTemplateInputCatalog(savedWorkspace.templates);
      const initialClients =
        savedWorkspace.clients.length > 0
          ? savedWorkspace.clients.map((client) => normalizeClient(client, inputCatalog))
          : [createClient(1, inputCatalog)];
      const nextWorkspace = {
        ...savedWorkspace,
        clients: initialClients,
      };

      setWorkspace(nextWorkspace);
      setTemplates(savedWorkspace.templates);
      setSelectedTemplateIds(savedWorkspace.templates.map((template) => template.id));
      setClients(initialClients);
      setActiveClientId(initialClients[0]?.id ?? "");
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedTemplates = useMemo(
    () => templates.filter((template) => selectedTemplateIds.includes(template.id)),
    [selectedTemplateIds, templates]
  );

  const inputCatalog = useMemo(
    () => getTemplateInputCatalog(selectedTemplates),
    [selectedTemplates]
  );

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId) ?? clients[0] ?? null,
    [activeClientId, clients]
  );

  const activeClientUnitCount = useMemo(
    () => getClientUnitCount(activeClient, inputCatalog),
    [activeClient, inputCatalog]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDashboardResults(
        getSavedResultsForClient(
          activeClientId,
          selectedTemplateIds,
          workspace.runResults
        )
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeClientId, selectedTemplateIds, workspace.runResults]);

  const persistWorkspace = async (nextWorkspace: WorkbookWorkspaceData) => {
    setWorkspace(nextWorkspace);
    await writePersistedWorkbookWorkspace(nextWorkspace);
  };

  const persistClients = async (nextClients: WorkbookClientFile[]) => {
    setClients(nextClients);
    await persistWorkspace({
      ...workspace,
      clients: nextClients,
    });
  };

  const updateClient = (clientId: string, nextValue: Partial<WorkbookClientFile>) => {
    const nextClients = clients.map((client) =>
      client.id === clientId
        ? { ...client, ...nextValue, updatedAt: new Date().toISOString() }
        : client
    );
    const nextRunResults = workspace.runResults.filter(
      (result) => result.clientId !== clientId
    );

    setWorkspace((current) => ({
      ...current,
      clients: nextClients,
      runResults: nextRunResults,
    }));
    void writePersistedWorkbookWorkspace({
      ...workspace,
      clients: nextClients,
      runResults: nextRunResults,
    });
    setClients(nextClients);
    setDashboardResults([]);
  };

  const updateClientValue = (clientId: string, inputLabel: string, value: string | string[]) => {
    const nextClients = clients.map((client) =>
      client.id === clientId
        ? {
            ...client,
            values: {
              ...client.values,
              [inputLabel]: value,
            },
            updatedAt: new Date().toISOString(),
          }
        : client
    );
    const nextRunResults = workspace.runResults.filter(
      (result) => result.clientId !== clientId
    );

    setWorkspace((current) => ({
      ...current,
      clients: nextClients,
      runResults: nextRunResults,
    }));
    void writePersistedWorkbookWorkspace({
      ...workspace,
      clients: nextClients,
      runResults: nextRunResults,
    });
    setClients(nextClients);
    setDashboardResults([]);
  };

  const updateClientValueAt = (
    clientId: string,
    inputLabel: string,
    valueIndex: number,
    value: string
  ) => {
    const currentValues = normalizeClientValueList(
      clients.find((client) => client.id === clientId)?.values[inputLabel]
    );
    const nextValues = currentValues.map((currentValue, index) =>
      index === valueIndex ? value : currentValue
    );

    updateClientValue(clientId, inputLabel, nextValues);
  };

  const resizeClientUnits = (clientId: string, nextUnitCount: number) => {
    const safeUnitCount = Math.max(1, nextUnitCount);
    const nextClients = clients.map((client) => {
      if (client.id !== clientId) {
        return client;
      }

      return {
        ...client,
        values: {
          ...client.values,
          ...Object.fromEntries(
            inputCatalog.map((input) => [
              input.label,
              resizeValues(
                normalizeClientValueList(client.values[input.label]),
                safeUnitCount
              ),
            ])
          ),
        },
        updatedAt: new Date().toISOString(),
      };
    });

    void persistClients(nextClients);
    setOpenUnitKeys((current) => {
      const nextOpenUnits: Record<string, boolean> = {};

      for (let unitIndex = 0; unitIndex < safeUnitCount; unitIndex += 1) {
        const unitKey = `${clientId}:${unitIndex}`;
        nextOpenUnits[unitKey] =
          unitIndex === safeUnitCount - 1 ? true : current[unitKey] ?? unitIndex === 0;
      }

      return {
        ...current,
        ...nextOpenUnits,
      };
    });
  };

  const addClient = () => {
    const nextClient = createClient(clients.length + 1, inputCatalog);
    const nextClients = [...clients, nextClient];
    void persistClients(nextClients);
    setActiveClientId(nextClient.id);
  };

  const deleteClient = (clientId: string) => {
    if (clients.length === 1) {
      return;
    }

    const nextClients = clients.filter((client) => client.id !== clientId);
    const nextRunResults = workspace.runResults.filter(
      (result) => result.clientId !== clientId
    );

    setWorkspace((current) => ({
      ...current,
      clients: nextClients,
      runResults: nextRunResults,
    }));
    void writePersistedWorkbookWorkspace({
      ...workspace,
      clients: nextClients,
      runResults: nextRunResults,
    });
    setClients(nextClients);
    setActiveClientId(nextClients[0]?.id ?? "");
  };

  const toggleTemplate = (templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    );
  };

  const runSelectedTemplates = async () => {
    if (!activeClient) {
      setMessage("Create a client before running worksheets.");
      return;
    }

    if (selectedTemplates.length === 0) {
      setMessage("Select at least one saved template to run.");
      return;
    }

    setIsRunning(true);
    setMessage(null);

    try {
      const results: WorkbookDashboardRunResult[] = [];
      const savedResults: SavedWorkbookRunResult[] = [];

      for (const template of selectedTemplates) {
        try {
          const response = await runWorkbookTemplate({
            workbook: base64ToFile(template.fileBase64, template.fileName),
            templateInputs: template.inputs,
            templateOutputs: template.outputs,
            client: activeClient,
          });
          const result = {
            templateId: template.id,
            templateName: template.name,
            response,
          };

          results.push(result);
          savedResults.push({
            ...result,
            clientId: activeClient.id,
            updatedAt: new Date().toISOString(),
          });
        } catch (error) {
          toast.error(`Worksheet failed: ${template.name}`, {
            description:
              error instanceof Error ? error.message : "Unable to run worksheet.",
          });
        }
      }

      if (savedResults.length) {
        const byResultKey = new Map<string, SavedWorkbookRunResult>();

        for (const result of [...workspace.runResults, ...savedResults]) {
          byResultKey.set(`${result.clientId}:${result.templateId}`, result);
        }

        const nextRunResults = Array.from(byResultKey.values()).sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt)
        );
        const nextWorkspace = {
          ...workspace,
          clients,
          runResults: nextRunResults,
        };

        setWorkspace(nextWorkspace);
        await writePersistedWorkbookWorkspace(nextWorkspace);
      }

      const nextResults = getSavedResultsForClient(
        activeClient.id,
        selectedTemplateIds,
        savedResults.length
          ? Array.from(
              new Map(
                [...workspace.runResults, ...savedResults].map((result) => [
                  `${result.clientId}:${result.templateId}`,
                  result,
                ])
              ).values()
            )
          : workspace.runResults
      );
      setDashboardResults(nextResults);
      setMessage(
        results.length
          ? `Ran ${results.length} worksheets for ${activeClient.name}.`
          : "No worksheets completed. Check the notifications for details."
      );
    } catch (error) {
      toast.error("Unable to run worksheets", {
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <AppShell
      title="Client worksheet dashboard"
      eyebrow="Client Runner"
      description="Select saved lender templates, enter the client's values once, run all selected Excel worksheets, and compare the returned outputs."
    >
      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="glass-panel rounded-lg p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Clients
                </p>
                <h2 className="mt-2 text-xl font-semibold">Client files</h2>
              </div>
              <button
                type="button"
                onClick={addClient}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
              >
                Add
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {clients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setActiveClientId(client.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    client.id === activeClientId
                      ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                      : "border-[var(--line)] bg-white"
                  }`}
                >
                  {client.name}
                </button>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Templates
            </p>
            <div className="mt-4 space-y-2">
              {templates.length ? (
                templates.map((template) => {
                  const isSelected = selectedTemplateIds.includes(template.id);

                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => toggleTemplate(template.id)}
                      className={`w-full rounded-md border px-3 py-3 text-left text-sm ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                          : "border-[var(--line)] bg-white"
                      }`}
                    >
                      <span className="block font-medium">{template.name}</span>
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        {template.outputs.length} outputs, {template.inputs.length} inputs
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="rounded-md border border-dashed border-[var(--line)] bg-white/60 p-4 text-sm leading-6 text-[var(--muted)]">
                  No saved templates. Create them from Template Library first.
                </p>
              )}
            </div>
          </section>

          <section className="glass-panel rounded-lg p-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Status
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">{selectedTemplates.length}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">selected</p>
              </div>
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">{inputCatalog.length}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">inputs</p>
              </div>
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">{dashboardResults.length}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">results</p>
              </div>
              <div className="rounded-md border border-[var(--line)] bg-white/80 p-3">
                <p className="text-2xl font-semibold">
                  {(initialData.scenarios ?? []).length}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">legacy files</p>
              </div>
            </div>
          </section>
        </aside>

        <main className="space-y-6">
          <section className="glass-panel rounded-lg p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Intake
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {activeClient?.name ?? "Client"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeClient ? (
                  <button
                    type="button"
                    onClick={() => deleteClient(activeClient.id)}
                    className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  >
                    Delete client
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={runSelectedTemplates}
                  disabled={isRunning || selectedTemplates.length === 0}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunning ? "Running..." : "Run selected worksheets"}
                </button>
              </div>
            </div>

            {message ? (
              <p className="mt-4 rounded-md border border-[var(--line)] bg-white/80 p-3 text-sm">
                {message}
              </p>
            ) : null}

            {activeClient ? (
              <div className="mt-5 space-y-5">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Client name</span>
                  <input
                    value={activeClient.name}
                    onChange={(event) =>
                      updateClient(activeClient.id, { name: event.target.value })
                    }
                    className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2"
                  />
                </label>

                {inputCatalog.length ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-white/70 p-3">
                      <div>
                        <p className="text-sm font-medium">
                          Units: {activeClientUnitCount}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          Add one unit when the client has another property or repeated
                          worksheet entry. Each client input gets one matching row.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            resizeClientUnits(
                              activeClient.id,
                              activeClientUnitCount + 1
                            )
                          }
                          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                        >
                          Add unit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            resizeClientUnits(
                              activeClient.id,
                              activeClientUnitCount - 1
                            )
                          }
                          disabled={activeClientUnitCount === 1}
                          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove last unit
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {Array.from({ length: activeClientUnitCount }, (_, unitIndex) => {
                        const unitKey = `${activeClient.id}:${unitIndex}`;
                        const isOpen =
                          openUnitKeys[unitKey] ?? unitIndex === activeClientUnitCount - 1;

                        return (
                          <details
                            key={unitKey}
                            open={isOpen}
                            onToggle={(event) => {
                              const nextOpen = event.currentTarget.open;

                              setOpenUnitKeys((current) => ({
                                ...current,
                                [unitKey]: nextOpen,
                              }));
                            }}
                            className="rounded-lg border border-[var(--line)] bg-white/75 p-4"
                          >
                            <summary className="cursor-pointer list-none">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">Unit {unitIndex + 1}</p>
                                  <p className="text-xs text-[var(--muted)]">
                                    Complete this set once for the matching workbook cells.
                                  </p>
                                </div>
                                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]">
                                  {isOpen ? "Collapse" : "Expand"}
                                </span>
                              </div>
                            </summary>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              {inputCatalog.map((input) => {
                                const values = resizeValues(
                                  normalizeClientValueList(
                                    activeClient.values[input.label]
                                  ),
                                  activeClientUnitCount
                                );
                                const value = values[unitIndex] ?? "";

                                return (
                                  <label
                                    key={`${unitKey}-${input.label}`}
                                    className="block space-y-2"
                                  >
                                    <span className="text-sm font-medium">
                                      {input.label}
                                    </span>
                                    {input.kind === "select" && input.options?.length ? (
                                      <select
                                        value={value}
                                        onChange={(event) =>
                                          updateClientValueAt(
                                            activeClient.id,
                                            input.label,
                                            unitIndex,
                                            event.target.value
                                          )
                                        }
                                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2"
                                      >
                                        <option value="">Select...</option>
                                        {input.options.map((option) => (
                                          <option key={option} value={option}>
                                            {option}
                                          </option>
                                        ))}
                                      </select>
                                    ) : input.kind === "boolean" ? (
                                      <select
                                        value={value || "false"}
                                        onChange={(event) =>
                                          updateClientValueAt(
                                            activeClient.id,
                                            input.label,
                                            unitIndex,
                                            event.target.value
                                          )
                                        }
                                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2"
                                      >
                                        <option value="false">No</option>
                                        <option value="true">Yes</option>
                                      </select>
                                    ) : (
                                      <input
                                        type={getInputType(input.kind)}
                                        value={normalizeClientValue(value)}
                                        onChange={(event) =>
                                          updateClientValueAt(
                                            activeClient.id,
                                            input.label,
                                            unitIndex,
                                            event.target.value
                                          )
                                        }
                                        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2"
                                      />
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-[var(--line)] bg-white/60 p-4 text-sm leading-6 text-[var(--muted)]">
                    Select saved templates to reveal their combined client inputs.
                  </p>
                )}
              </div>
            ) : null}
          </section>

          {dashboardResults.length ? (
            <section className="glass-panel rounded-lg p-6">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Results
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-[var(--line)] px-3 py-2 text-left font-medium">
                        Template
                      </th>
                      <th className="border-b border-[var(--line)] px-3 py-2 text-left font-medium">
                        Output
                      </th>
                      <th className="border-b border-[var(--line)] px-3 py-2 text-left font-medium">
                        Cell
                      </th>
                      <th className="border-b border-[var(--line)] px-3 py-2 text-right font-medium">
                        Value
                      </th>
                      <th className="border-b border-[var(--line)] px-3 py-2 text-right font-medium">
                        File
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardResults.flatMap((result) =>
                      result.response.outputs.map((output, outputIndex) => (
                        <tr key={`${result.templateId}-${output.key}-${output.cell}`}>
                          <td className="border-b border-[var(--line)] px-3 py-3">
                            {outputIndex === 0 ? result.templateName : ""}
                          </td>
                          <td className="border-b border-[var(--line)] px-3 py-3">
                            {output.label}
                          </td>
                          <td className="border-b border-[var(--line)] px-3 py-3 font-mono text-xs text-[var(--muted)]">
                            {output.sheetName}!{output.cell}
                          </td>
                          <td className="border-b border-[var(--line)] px-3 py-3 text-right font-semibold">
                            {formatOutputValue(output.value, output.displayValue)}
                          </td>
                          <td className="border-b border-[var(--line)] px-3 py-3 text-right">
                            {outputIndex === 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  downloadBase64Workbook(
                                    result.response.completedWorkbook,
                                    result.response.completedWorkbookName
                                  )
                                }
                                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
                              >
                                Download
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 space-y-2 rounded-md border border-[var(--line)] bg-white/80 p-3 text-sm leading-6 text-[var(--muted)]">
                {dashboardResults.map((result) => (
                  <p key={`${result.templateId}-recalc`}>
                    <span className="font-medium text-[var(--ink)]">
                      {result.templateName}:
                    </span>{" "}
                    {result.response.recalc.message}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </section>
    </AppShell>
  );
}
