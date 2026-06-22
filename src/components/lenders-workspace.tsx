"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  buildFormulaPlaceholders,
  DEFAULT_ACTIVE_FORMULA_KEYS,
  DEFAULT_FORMULAS,
  extractFormulaIdentifiers,
  FORMULA_LABELS,
  FORMULA_SEQUENCE,
  formatInputKind,
  isFormulaRelevant,
  PROVINCES,
  toNumber,
  validateFormula,
} from "@/lib/calc";
import { invokeRentalApi } from "@/lib/rental-api";
import type {
  BootstrapPayload,
  DwellingType,
  InputKind,
  Lender,
  LenderFormulaKey,
  RentalVariable,
} from "@/lib/types";

function createDraftLender(): Lender {
  return {
    name: "",
    notes: "",
    variableKeys: [],
    activeFormulaKeys: [...DEFAULT_ACTIVE_FORMULA_KEYS],
    provinceVacancyRates: {},
    dwellingTypePercentages: {},
    formulas: { ...DEFAULT_FORMULAS },
  };
}

function normalizeLender(lender: Partial<Lender>): Lender {
  return {
    id: lender.id,
    name: lender.name ?? "",
    notes: lender.notes ?? "",
    variableKeys: lender.variableKeys ?? [],
    activeFormulaKeys: lender.activeFormulaKeys ?? [...DEFAULT_ACTIVE_FORMULA_KEYS],
    provinceVacancyRates: lender.provinceVacancyRates ?? {},
    dwellingTypePercentages: lender.dwellingTypePercentages ?? {},
    formulas: {
      ...DEFAULT_FORMULAS,
      ...(lender.formulas ?? {}),
    },
  };
}

type LendersWorkspaceProps = {
  initialData: BootstrapPayload;
};

type VariableDraft = {
  key: string;
  label: string;
  description: string;
  inputKind: InputKind;
  dependsOnKey: string;
  dependsOnValue: string;
  displayOrder: string;
};

type DwellingTypeDraft = {
  key: string;
  label: string;
  displayOrder: string;
};

const EMPTY_VARIABLE_DRAFT: VariableDraft = {
  key: "",
  label: "",
  description: "",
  inputKind: "currency",
  dependsOnKey: "",
  dependsOnValue: "",
  displayOrder: "0",
};

const EMPTY_DWELLING_TYPE_DRAFT: DwellingTypeDraft = {
  key: "",
  label: "",
  displayOrder: "0",
};

function toVariableDraft(variable?: RentalVariable): VariableDraft {
  if (!variable) {
    return EMPTY_VARIABLE_DRAFT;
  }

  return {
    key: variable.key,
    label: variable.label,
    description: variable.description,
    inputKind: variable.inputKind,
    dependsOnKey: variable.dependsOnKey ?? "",
    dependsOnValue: variable.dependsOnValue === null ? "" : String(variable.dependsOnValue),
    displayOrder: String(variable.displayOrder),
  };
}

function toDwellingTypeDraft(dwellingType?: DwellingType): DwellingTypeDraft {
  if (!dwellingType) {
    return EMPTY_DWELLING_TYPE_DRAFT;
  }

  return {
    key: dwellingType.key,
    label: dwellingType.label,
    displayOrder: String(dwellingType.displayOrder),
  };
}

function toVariableKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function LendersWorkspace({ initialData }: LendersWorkspaceProps) {
  const [variables, setVariables] = useState<RentalVariable[]>(initialData.variables);
  const [dwellingTypes, setDwellingTypes] = useState<DwellingType[]>(
    initialData.dwellingTypes ?? []
  );
  const [lenders, setLenders] = useState<Lender[]>(
    initialData.lenders.length > 0
      ? initialData.lenders.map(normalizeLender)
      : [createDraftLender()]
  );
  const [focusedLenderIndex, setFocusedLenderIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [editingVariableKey, setEditingVariableKey] = useState<string | null>(null);
  const [variableDraft, setVariableDraft] = useState<VariableDraft>(EMPTY_VARIABLE_DRAFT);
  const [editingDwellingTypeKey, setEditingDwellingTypeKey] = useState<string | null>(null);
  const [dwellingTypeDraft, setDwellingTypeDraft] =
    useState<DwellingTypeDraft>(EMPTY_DWELLING_TYPE_DRAFT);
  const [isVariableSaving, setIsVariableSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshData = async () => {
    setMessage(null);

    try {
      const data = await invokeRentalApi<BootstrapPayload>("bootstrap");
      const nextLenders =
        data.lenders.length > 0
          ? data.lenders.map(normalizeLender)
          : [createDraftLender()];
      setVariables(data.variables ?? []);
      setDwellingTypes(data.dwellingTypes ?? []);
      setLenders(nextLenders);
      setFocusedLenderIndex((current) => Math.min(current, nextLenders.length - 1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load lender data.");
    } finally {
      setIsLoading(false);
    }
  };

  const focusedLender = lenders[focusedLenderIndex] ?? null;

  const activeVariables = useMemo(() => {
    if (!focusedLender) {
      return [];
    }

    return variables.filter((variable) => focusedLender.variableKeys.includes(variable.key));
  }, [focusedLender, variables]);

  const availableVariables = useMemo(() => {
    if (!focusedLender) {
      return [];
    }

    return variables.filter((variable) => !focusedLender.variableKeys.includes(variable.key));
  }, [focusedLender, variables]);

  const activeFormulaPlaceholders = useMemo(() => {
    if (!focusedLender) {
      return [];
    }

    const allPlaceholders = buildFormulaPlaceholders(variables);

    const allowedVariableKeys = new Set(focusedLender.variableKeys);
    const activeMetricKeys = new Set(
      FORMULA_SEQUENCE.filter((formulaKey) =>
        isFormulaRelevant(focusedLender, formulaKey)
      )
    );

    return allPlaceholders.filter((placeholder) => {
      if (
        placeholder.key === "provincial_vacancy_rate" ||
        placeholder.key === "dwelling_type_percentage"
      ) {
        return true;
      }

      if (
        placeholder.key === "vacancy_rate" ||
        placeholder.key === "economic_rent" ||
        placeholder.key === "maintenance" ||
        placeholder.key === "vacancy_amount" ||
        placeholder.key === "surplus_shortfall" ||
        placeholder.key === "dcr"
      ) {
        return activeMetricKeys.has(placeholder.key);
      }

      return allowedVariableKeys.has(placeholder.key);
    });
  }, [focusedLender, variables]);

  const updateLender = (index: number, nextValue: Partial<Lender>) => {
    setLenders((current) =>
      current.map((lender, lenderIndex) =>
        lenderIndex === index ? { ...lender, ...nextValue } : lender
      )
    );
  };

  const updateFormula = (
    lenderIndex: number,
    formulaKey: LenderFormulaKey,
    formula: string
  ) => {
    setLenders((current) =>
      current.map((lender, index) =>
        index === lenderIndex
          ? {
              ...lender,
              formulas: {
                ...lender.formulas,
                [formulaKey]: formula,
              },
            }
          : lender
      )
    );
  };

  const updateProvinceVacancyRate = (
    lenderIndex: number,
    provinceCode: keyof Lender["provinceVacancyRates"],
    rawValue: string
  ) => {
    setLenders((current) =>
      current.map((lender, index) =>
        index === lenderIndex
          ? {
              ...lender,
              provinceVacancyRates: {
                ...lender.provinceVacancyRates,
                [provinceCode]: toNumber(rawValue),
              },
            }
          : lender
      )
    );
  };

  const updateDwellingTypePercentage = (
    lenderIndex: number,
    dwellingTypeKey: string,
    rawValue: string
  ) => {
    setLenders((current) =>
      current.map((lender, index) =>
        index === lenderIndex
          ? {
              ...lender,
              dwellingTypePercentages: {
                ...lender.dwellingTypePercentages,
                [dwellingTypeKey]: toNumber(rawValue),
              },
            }
          : lender
      )
    );
  };

  const toggleFormulaRelevance = (
    lenderIndex: number,
    formulaKey: LenderFormulaKey
  ) => {
    if (formulaKey === "surplus_shortfall") {
      return;
    }

    setLenders((current) =>
      current.map((lender, index) => {
        if (index !== lenderIndex) {
          return lender;
        }

        const nextActiveFormulaKeys = lender.activeFormulaKeys.includes(formulaKey)
          ? lender.activeFormulaKeys.filter((key) => key !== formulaKey)
          : [...lender.activeFormulaKeys, formulaKey];

        return {
          ...lender,
          activeFormulaKeys: nextActiveFormulaKeys,
        };
      })
    );
  };

  const insertFormulaToken = (
    lenderIndex: number,
    formulaKey: LenderFormulaKey,
    token: string
  ) => {
    setLenders((current) =>
      current.map((lender, index) => {
        if (index !== lenderIndex) {
          return lender;
        }

        const currentFormula = lender.formulas[formulaKey].trim();
        const nextFormula = currentFormula
          ? `${currentFormula} ${token}`
          : token;

        return {
          ...lender,
          formulas: {
            ...lender.formulas,
            [formulaKey]: nextFormula,
          },
        };
      })
    );
  };

  const handleAddLender = () => {
    setLenders((current) => {
      const next = [...current, createDraftLender()];
      setFocusedLenderIndex(next.length - 1);
      return next;
    });
  };

  const toggleVariable = (lenderIndex: number, variableKey: string) => {
    setLenders((current) =>
      current.map((lender, index) => {
        if (index !== lenderIndex) {
          return lender;
        }

        const nextVariableKeys = lender.variableKeys.includes(variableKey)
          ? lender.variableKeys.filter((key) => key !== variableKey)
          : [...lender.variableKeys, variableKey];

        nextVariableKeys.sort((left, right) => {
          const leftOrder =
            variables.find((variable) => variable.key === left)?.displayOrder ?? 0;
          const rightOrder =
            variables.find((variable) => variable.key === right)?.displayOrder ?? 0;

          return leftOrder - rightOrder;
        });

        return {
          ...lender,
          variableKeys: nextVariableKeys,
        };
      })
    );
  };

  const handleSave = async (lender: Lender, lenderIndex: number) => {
    if (!lender.name.trim()) {
      setMessage("Each lender needs a name before it can be saved.");
      return;
    }

    if (lender.variableKeys.length === 0) {
      setMessage("Add at least one client input field for the lender.");
      return;
    }

    for (const formulaKey of FORMULA_SEQUENCE) {
      if (!isFormulaRelevant(lender, formulaKey)) {
        continue;
      }

      const validationError = validateFormula(lender.formulas[formulaKey], variables);

      if (validationError) {
        setMessage(`${FORMULA_LABELS[formulaKey]}: ${validationError}`);
        return;
      }

      const identifiers = extractFormulaIdentifiers(lender.formulas[formulaKey]);
      const disallowedInput = identifiers.find(
        (identifier) =>
          variables.some((variable) => variable.key === identifier) &&
          !lender.variableKeys.includes(identifier)
      );

      if (disallowedInput) {
        setMessage(
          `${FORMULA_LABELS[formulaKey]} uses ${disallowedInput}, but that input is not enabled for this lender.`
        );
        return;
      }
    }

    setIsSaving(lender.id ?? `draft-${lenderIndex}`);
    setMessage(null);

    try {
      await invokeRentalApi("save_lender", { lender });
      await refreshData();
      setMessage(`Saved ${lender.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save lender.");
    } finally {
      setIsSaving(null);
    }
  };

  const handleDelete = async (lender: Lender, lenderIndex: number) => {
    if (!lender.id) {
      setLenders((current) => {
        const next = current.filter((_, index) => index !== lenderIndex);
        const fallback = next.length > 0 ? next : [createDraftLender()];
        setFocusedLenderIndex((currentIndex) =>
          Math.min(currentIndex, fallback.length - 1)
        );
        return fallback;
      });
      return;
    }

    const confirmed = window.confirm(`Delete ${lender.name}?`);

    if (!confirmed) {
      return;
    }

    setIsSaving(lender.id);
    setMessage(null);

    try {
      await invokeRentalApi("delete_lender", { lenderId: lender.id });
      await refreshData();
      setMessage(`Deleted ${lender.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete lender.");
    } finally {
      setIsSaving(null);
    }
  };

  const updateVariableDraft = (nextValue: Partial<VariableDraft>) => {
    setVariableDraft((current) => ({ ...current, ...nextValue }));
  };

  const handleNewVariable = () => {
    setEditingVariableKey(null);
    setVariableDraft(EMPTY_VARIABLE_DRAFT);
    setMessage(null);
  };

  const handleEditVariable = (variable: RentalVariable) => {
    setEditingVariableKey(variable.key);
    setVariableDraft(toVariableDraft(variable));
    setMessage(null);
  };

  const handleVariableLabelChange = (label: string) => {
    setVariableDraft((current) => {
      const shouldRegenerateKey =
        !editingVariableKey &&
        (!current.key || current.key === toVariableKey(current.label));

      return {
        ...current,
        label,
        key: shouldRegenerateKey ? toVariableKey(label) : current.key,
      };
    });
  };

  const handleSaveVariable = async () => {
    const key = toVariableKey(variableDraft.key);
    const label = variableDraft.label.trim();

    if (!key) {
      setMessage("Each available input needs a key.");
      return;
    }

    if (!label) {
      setMessage("Each available input needs a label.");
      return;
    }

    setIsVariableSaving(true);
    setMessage(null);

    try {
      await invokeRentalApi("save_variable", {
        variable: {
          key,
          label,
          description: variableDraft.description.trim(),
          inputKind: variableDraft.inputKind,
          dependsOnKey: variableDraft.dependsOnKey || null,
          dependsOnValue:
            variableDraft.dependsOnValue === ""
              ? null
              : Number(variableDraft.dependsOnValue),
          displayOrder: Number(variableDraft.displayOrder) || 0,
        },
      });
      await refreshData();
      handleNewVariable();
      setMessage(`Saved available input ${label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save input.");
    } finally {
      setIsVariableSaving(false);
    }
  };

  const handleDeleteVariable = async (variable: RentalVariable) => {
    const confirmed = window.confirm(`Delete ${variable.label}?`);

    if (!confirmed) {
      return;
    }

    setIsVariableSaving(true);
    setMessage(null);

    try {
      await invokeRentalApi("delete_variable", {
        variableKey: variable.key,
      });
      await refreshData();
      if (editingVariableKey === variable.key) {
        handleNewVariable();
      }
      setMessage(`Deleted available input ${variable.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete input.");
    } finally {
      setIsVariableSaving(false);
    }
  };

  const updateDwellingTypeDraft = (nextValue: Partial<DwellingTypeDraft>) => {
    setDwellingTypeDraft((current) => ({ ...current, ...nextValue }));
  };

  const handleNewDwellingType = () => {
    setEditingDwellingTypeKey(null);
    setDwellingTypeDraft(EMPTY_DWELLING_TYPE_DRAFT);
    setMessage(null);
  };

  const handleEditDwellingType = (dwellingType: DwellingType) => {
    setEditingDwellingTypeKey(dwellingType.key);
    setDwellingTypeDraft(toDwellingTypeDraft(dwellingType));
    setMessage(null);
  };

  const handleDwellingTypeLabelChange = (label: string) => {
    setDwellingTypeDraft((current) => {
      const shouldRegenerateKey =
        !editingDwellingTypeKey &&
        (!current.key || current.key === toVariableKey(current.label));

      return {
        ...current,
        label,
        key: shouldRegenerateKey ? toVariableKey(label) : current.key,
      };
    });
  };

  const handleSaveDwellingType = async () => {
    const key = toVariableKey(dwellingTypeDraft.key);
    const label = dwellingTypeDraft.label.trim();

    if (!key) {
      setMessage("Each dwelling type needs a key.");
      return;
    }

    if (!label) {
      setMessage("Each dwelling type needs a label.");
      return;
    }

    setIsVariableSaving(true);
    setMessage(null);

    try {
      await invokeRentalApi("save_dwelling_type", {
        dwellingType: {
          key,
          label,
          displayOrder: Number(dwellingTypeDraft.displayOrder) || 0,
        },
      });
      await refreshData();
      handleNewDwellingType();
      setMessage(`Saved dwelling type ${label}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save dwelling type."
      );
    } finally {
      setIsVariableSaving(false);
    }
  };

  const handleDeleteDwellingType = async (dwellingType: DwellingType) => {
    const confirmed = window.confirm(`Delete ${dwellingType.label}?`);

    if (!confirmed) {
      return;
    }

    setIsVariableSaving(true);
    setMessage(null);

    try {
      await invokeRentalApi("delete_dwelling_type", {
        dwellingTypeKey: dwellingType.key,
      });
      await refreshData();
      if (editingDwellingTypeKey === dwellingType.key) {
        handleNewDwellingType();
      }
      setMessage(`Deleted dwelling type ${dwellingType.label}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete dwelling type."
      );
    } finally {
      setIsVariableSaving(false);
    }
  };

  return (
    <AppShell
      title="Lender-by-lender rental formulas"
      eyebrow="Page 1"
      description="Pick one lender from the list, choose the client inputs that lender needs, and define the formulas used to calculate vacancy, maintenance, surplus or shortfall, and DCR."
    >
      <section className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="glass-panel rounded-[28px] p-6">
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent-strong)]">
              Lenders
            </p>
            <h2 className="text-2xl font-semibold tracking-[-0.03em]">
              Choose a lender to edit
            </h2>
            <p className="text-sm leading-7 text-[var(--muted)]">
              This list comes from the database. Select a lender to edit its required
              client inputs and formula set, or create a new lender.
            </p>
          </div>

          <button
            type="button"
            onClick={handleAddLender}
            className="mt-6 w-full rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)]"
          >
            Add lender
          </button>

          <div className="mt-6 space-y-3">
            {lenders.map((lender, lenderIndex) => {
              const isFocused = lenderIndex === focusedLenderIndex;

              return (
                <button
                  key={lender.id ?? `lender-nav-${lenderIndex}`}
                  type="button"
                  onClick={() => setFocusedLenderIndex(lenderIndex)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    isFocused
                      ? "border-[var(--accent)] bg-amber-50"
                      : "border-[var(--line)] bg-white/70 hover:border-[var(--accent)]"
                  }`}
                >
                  <p className="font-medium">
                    {lender.name.trim() || `Untitled Lender ${lenderIndex + 1}`}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                    {lender.variableKeys.length} required input
                    {lender.variableKeys.length === 1 ? "" : "s"}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="space-y-6">
          {message ? (
            <div className="rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-3 text-sm">
              {message}
            </div>
          ) : null}

          {isLoading ? (
            <div className="glass-panel rounded-[28px] px-6 py-10 text-center text-sm text-[var(--muted)]">
              Loading lender formulas...
            </div>
          ) : null}

          {!isLoading && focusedLender ? (
            <article className="glass-panel rounded-[28px] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Active Lender
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                    {focusedLender.name.trim() ||
                      `Untitled Lender ${focusedLenderIndex + 1}`}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(focusedLender, focusedLenderIndex)}
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                >
                  Delete lender
                </button>
              </div>

              <div className="mt-6 grid gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Lender name</span>
                  <input
                    value={focusedLender.name}
                    onChange={(event) =>
                      updateLender(focusedLenderIndex, { name: event.target.value })
                    }
                    placeholder="Example: RBC Rental Program"
                    className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
              </div>

              <label className="mt-4 block space-y-2">
                <span className="text-sm font-medium">Notes</span>
                <textarea
                  value={focusedLender.notes}
                  onChange={(event) =>
                    updateLender(focusedLenderIndex, { notes: event.target.value })
                  }
                  rows={3}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)]"
                  placeholder="Optional underwriting notes for this lender."
                />
              </label>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div className="rounded-3xl border border-[var(--line)] bg-white/70 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Required Client Inputs
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Click a field to remove it from this lender. The client calculator only
                    asks for fields required by the lenders being checked.
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {activeVariables.length > 0 ? (
                      activeVariables.map((variable) => (
                        <button
                          key={variable.key}
                          type="button"
                          onClick={() => toggleVariable(focusedLenderIndex, variable.key)}
                          className="rounded-full bg-amber-100 px-4 py-2 text-sm text-amber-950 ring-1 ring-amber-300 transition hover:bg-amber-200"
                        >
                          {variable.label} Remove
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        No client inputs selected yet.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-[var(--line)] bg-white/70 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Available Inputs
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Click an input to add it to this lender.
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {availableVariables.length > 0 ? (
                      availableVariables.map((variable) => (
                        <button
                          key={variable.key}
                          type="button"
                          onClick={() => toggleVariable(focusedLenderIndex, variable.key)}
                          className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                        >
                          {variable.label}
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        All fixed input fields are already attached to this lender.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {isFormulaRelevant(focusedLender, "vacancy_rate") ? (
                <div className="mt-6 rounded-3xl border border-[var(--line)] bg-white/70 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Province Vacancy Rates
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Set the vacancy percentage this lender uses for each province. Use the
                    `provincial_vacancy_rate` placeholder inside formulas.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {PROVINCES.map((province) => (
                      <label
                        key={province.code}
                        className="rounded-2xl border border-[var(--line)] bg-white p-4"
                      >
                        <span className="block text-sm font-medium">
                          {province.label}
                        </span>
                        <input
                          type="number"
                          step="0.0001"
                          value={focusedLender.provinceVacancyRates[province.code] ?? 0}
                          onChange={(event) =>
                            updateProvinceVacancyRate(
                              focusedLenderIndex,
                              province.code,
                              event.target.value
                            )
                          }
                          className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {isFormulaRelevant(focusedLender, "vacancy_rate") ? (
                <div className="mt-6 rounded-3xl border border-[var(--line)] bg-white/70 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Dwelling Type Percentages
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Set the percentage this lender uses for each dwelling type. Use the
                    `dwelling_type_percentage` placeholder inside formulas.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {dwellingTypes.map((dwellingType) => (
                      <label
                        key={dwellingType.key}
                        className="rounded-2xl border border-[var(--line)] bg-white p-4"
                      >
                        <span className="block text-sm font-medium">
                          {dwellingType.label}
                        </span>
                        <input
                          type="number"
                          step="0.0001"
                          value={
                            focusedLender.dwellingTypePercentages[dwellingType.key] ?? 0
                          }
                          onChange={(event) =>
                            updateDwellingTypePercentage(
                              focusedLenderIndex,
                              dwellingType.key,
                              event.target.value
                            )
                          }
                          className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-6 rounded-3xl border border-[var(--line)] bg-white/70 p-5">
                <div className="mb-5">
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Relevant Metrics
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Surplus / shortfall is always active. Turn on the other metrics only if
                    this lender uses them.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {FORMULA_SEQUENCE.map((formulaKey) => {
                      const isForced = formulaKey === "surplus_shortfall";
                      const isActive =
                        isForced ||
                        focusedLender.activeFormulaKeys.includes(formulaKey);

                      return (
                        <button
                          key={`relevance-${formulaKey}`}
                          type="button"
                          onClick={() =>
                            toggleFormulaRelevance(focusedLenderIndex, formulaKey)
                          }
                          disabled={isForced}
                          className={`rounded-full px-4 py-2 text-sm transition ${
                            isActive
                              ? "bg-amber-100 text-amber-950 ring-1 ring-amber-300"
                              : "border border-[var(--line)] bg-white hover:border-[var(--accent)]"
                          } ${isForced ? "cursor-default opacity-90" : ""}`}
                        >
                          {FORMULA_LABELS[formulaKey]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                      Formula Builder
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                      Use the variable keys directly in formulas. Earlier outputs can be
                      reused by later formulas.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  {FORMULA_SEQUENCE.filter((formulaKey) =>
                    isFormulaRelevant(focusedLender, formulaKey)
                  ).map((formulaKey) => (
                    <label
                      key={formulaKey}
                      className="rounded-2xl border border-[var(--line)] bg-white p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="block text-sm font-medium">
                          {FORMULA_LABELS[formulaKey]}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {formulaKey === "surplus_shortfall"
                            ? "Always active"
                            : "Relevant"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeFormulaPlaceholders.map((placeholder) => (
                          <button
                            key={`${formulaKey}-${placeholder.key}`}
                            type="button"
                            onClick={() =>
                              insertFormulaToken(
                                focusedLenderIndex,
                                formulaKey,
                                placeholder.key
                              )
                            }
                            className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs transition hover:border-[var(--accent)]"
                          >
                            {placeholder.label}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={focusedLender.formulas[formulaKey]}
                        onChange={(event) =>
                          updateFormula(
                            focusedLenderIndex,
                            formulaKey,
                            event.target.value
                          )
                        }
                        rows={2}
                        className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-[var(--accent)]"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => handleSave(focusedLender, focusedLenderIndex)}
                  disabled={isSaving === (focusedLender.id ?? `draft-${focusedLenderIndex}`)}
                  className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSaving === (focusedLender.id ?? `draft-${focusedLenderIndex}`)
                    ? "Saving..."
                    : "Save lender"}
                </button>
              </div>
            </article>
          ) : null}
        </section>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <article className="glass-panel rounded-[28px] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                Available Inputs
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                Global input catalog
              </h2>
              <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                Add or remove calculator inputs here. Inputs can be numeric, percent,
                currency, or yes/no, and can optionally depend on another input value.
              </p>
            </div>

            <button
              type="button"
              onClick={handleNewVariable}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--accent)]"
            >
              New input
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {variables.map((variable) => (
              <div
                key={variable.key}
                className="rounded-2xl border border-[var(--line)] bg-white/75 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{variable.label}</p>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        {formatInputKind(variable.inputKind)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-700">
                        {variable.key}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {variable.description || "No description saved."}
                    </p>
                    {variable.dependsOnKey ? (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Visible when `{variable.dependsOnKey}` ={" "}
                        {String(variable.dependsOnValue ?? 0)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditVariable(variable)}
                      className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--accent)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteVariable(variable)}
                      className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 rounded-3xl border border-[var(--line)] bg-white/70 p-5">
            <label className="space-y-2">
              <span className="text-sm font-medium">Input key</span>
              <input
                value={variableDraft.key}
                onChange={(event) =>
                  updateVariableDraft({ key: toVariableKey(event.target.value) })
                }
                disabled={Boolean(editingVariableKey)}
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 font-mono outline-none transition focus:border-[var(--accent)] disabled:bg-slate-50 disabled:text-[var(--muted)]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Label</span>
              <input
                value={variableDraft.label}
                onChange={(event) => handleVariableLabelChange(event.target.value)}
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Type</span>
              <select
                value={variableDraft.inputKind}
                onChange={(event) =>
                  updateVariableDraft({
                    inputKind: event.target.value as InputKind,
                  })
                }
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              >
                <option value="currency">Dollar / currency</option>
                <option value="percent">Percentage</option>
                <option value="number">Plain number</option>
                <option value="boolean">Yes / no</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Show only when input</span>
              <select
                value={variableDraft.dependsOnKey}
                onChange={(event) =>
                  updateVariableDraft({ dependsOnKey: event.target.value })
                }
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              >
                <option value="">Always visible</option>
                {variables
                  .filter((variable) => variable.key !== editingVariableKey)
                  .map((variable) => (
                    <option key={variable.key} value={variable.key}>
                      {variable.label}
                    </option>
                  ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Dependent value</span>
              <input
                type="number"
                value={variableDraft.dependsOnValue}
                onChange={(event) =>
                  updateVariableDraft({ dependsOnValue: event.target.value })
                }
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Display order</span>
              <input
                type="number"
                value={variableDraft.displayOrder}
                onChange={(event) =>
                  updateVariableDraft({ displayOrder: event.target.value })
                }
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Description</span>
              <textarea
                value={variableDraft.description}
                onChange={(event) =>
                  updateVariableDraft({ description: event.target.value })
                }
                rows={3}
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSaveVariable}
                disabled={isVariableSaving}
                className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isVariableSaving ? "Saving..." : "Save input"}
              </button>
              <button
                type="button"
                onClick={handleNewVariable}
                className="rounded-full border border-[var(--line)] px-5 py-3 text-sm transition hover:border-[var(--accent)]"
              >
                Reset form
              </button>
            </div>
          </div>
        </article>

        <article className="glass-panel rounded-[28px] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                Dwelling Types
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                Global dwelling type catalog
              </h2>
              <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                Add or remove dwelling types here. Lenders can then define a percentage
                for each one and formulas can reference `dwelling_type_percentage`.
              </p>
            </div>

            <button
              type="button"
              onClick={handleNewDwellingType}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--accent)]"
            >
              New dwelling type
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {dwellingTypes.map((dwellingType) => (
              <div
                key={dwellingType.key}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-white/75 p-4"
              >
                <div>
                  <p className="font-medium">{dwellingType.label}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                    {dwellingType.key}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditDwellingType(dwellingType)}
                    className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--accent)]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteDwellingType(dwellingType)}
                    className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 rounded-3xl border border-[var(--line)] bg-white/70 p-5">
            <label className="space-y-2">
              <span className="text-sm font-medium">Dwelling type key</span>
              <input
                value={dwellingTypeDraft.key}
                onChange={(event) =>
                  updateDwellingTypeDraft({ key: toVariableKey(event.target.value) })
                }
                disabled={Boolean(editingDwellingTypeKey)}
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 font-mono disabled:bg-slate-50 disabled:text-[var(--muted)]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Label</span>
              <input
                value={dwellingTypeDraft.label}
                onChange={(event) => handleDwellingTypeLabelChange(event.target.value)}
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium">Display order</span>
              <input
                type="number"
                value={dwellingTypeDraft.displayOrder}
                onChange={(event) =>
                  updateDwellingTypeDraft({ displayOrder: event.target.value })
                }
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSaveDwellingType}
                disabled={isVariableSaving}
                className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isVariableSaving ? "Saving..." : "Save dwelling type"}
              </button>
              <button
                type="button"
                onClick={handleNewDwellingType}
                className="rounded-full border border-[var(--line)] px-5 py-3 text-sm transition hover:border-[var(--accent)]"
              >
                Reset form
              </button>
            </div>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
