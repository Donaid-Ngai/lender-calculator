"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  aggregatePropertyValues,
  DEFAULT_ACTIVE_FORMULA_KEYS,
  calculateLenderResult,
  createEmptyProperty,
  DEFAULT_CLIENT_PROFILE,
  formatCurrency,
  formatFormulaResult,
  formatVariableDisplay,
  isFormulaRelevant,
  PROVINCES,
  toNumber,
} from "@/lib/calc";
import { invokeRentalApi } from "@/lib/rental-api";
import type {
  BootstrapPayload,
  ClientProperty,
  ClientProfile,
  ClientScenario,
  DwellingType,
  Lender,
  LenderFormulaKey,
  RentalVariable,
} from "@/lib/types";

type CalculatorWorkspaceProps = {
  initialData: BootstrapPayload;
};

const METRIC_ORDER: LenderFormulaKey[] = [
  "vacancy_rate",
  "economic_rent",
  "maintenance",
  "vacancy_amount",
  "surplus_shortfall",
  "dcr",
];

function compareResults(
  left: { result: { summaryValue: number; metrics: Record<LenderFormulaKey, number> } },
  right: { result: { summaryValue: number; metrics: Record<LenderFormulaKey, number> } }
) {
  if (right.result.summaryValue !== left.result.summaryValue) {
    return right.result.summaryValue - left.result.summaryValue;
  }

  return right.result.metrics.dcr - left.result.metrics.dcr;
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
      vacancy_rate: "provincial_vacancy_rate",
      economic_rent: "economic_rent_amount",
      maintenance: "gross_monthly_rent * 0.15",
      vacancy_amount: "gross_monthly_rent * vacancy_rate",
      surplus_shortfall:
        "gross_monthly_rent + other_monthly_rent - monthly_mortgage_payment - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount",
      dcr:
        "(gross_monthly_rent + other_monthly_rent - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount) / monthly_mortgage_payment",
      ...(lender.formulas ?? {}),
    },
  };
}

function normalizeScenario(scenario: Partial<ClientScenario>): ClientScenario {
  return {
    id: scenario.id ?? "",
    lenderId: scenario.lenderId ?? null,
    lenderName: scenario.lenderName ?? null,
    clientName: scenario.clientName ?? "",
    clientProfile: {
      ...DEFAULT_CLIENT_PROFILE,
      ...(scenario.clientProfile ?? {}),
    },
    properties: scenario.properties ?? [],
    summaryValue: Number(scenario.summaryValue ?? 0),
    dcr: Number(scenario.dcr ?? 0),
    updatedAt: scenario.updatedAt ?? new Date(0).toISOString(),
  };
}

export function CalculatorWorkspace({ initialData }: CalculatorWorkspaceProps) {
  const [data, setData] = useState<BootstrapPayload | null>({
    ...initialData,
    dwellingTypes: initialData.dwellingTypes ?? [],
    lenders: initialData.lenders.map(normalizeLender),
    scenarios: initialData.scenarios.map(normalizeScenario),
  });
  const [focusedLenderId, setFocusedLenderId] = useState<string>(
    initialData.lenders[0]?.id ?? ""
  );
  const [selectedLenderIds, setSelectedLenderIds] = useState<string[]>(
    initialData.lenders.map((lender) => lender.id).filter(Boolean) as string[]
  );
  const [checkAllLenders, setCheckAllLenders] = useState(true);
  const [clientName, setClientName] = useState("");
  const [clientProfile, setClientProfile] =
    useState<ClientProfile>(DEFAULT_CLIENT_PROFILE);
  const [properties, setProperties] = useState<ClientProperty[]>(
    initialData.variables.length > 0 ? [createEmptyProperty(initialData.variables, 1)] : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshData = async () => {
    setMessage(null);

    try {
      const nextData = await invokeRentalApi<BootstrapPayload>("bootstrap");
      setData({
        ...nextData,
        dwellingTypes: nextData.dwellingTypes ?? [],
        lenders: nextData.lenders.map(normalizeLender),
        scenarios: nextData.scenarios.map(normalizeScenario),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load calculator data.");
    } finally {
      setIsLoading(false);
    }
  };

  const aggregatedValues = useMemo(() => {
    if (!data) {
      return {} as Record<string, number>;
    }

    return aggregatePropertyValues(properties, data.variables);
  }, [data, properties]);

  const activeLenders = useMemo(() => {
    if (!data) {
      return [];
    }

    return checkAllLenders
      ? data.lenders
      : data.lenders.filter((lender) => lender.id && selectedLenderIds.includes(lender.id));
  }, [checkAllLenders, data, selectedLenderIds]);

  const requestedVariables = useMemo(() => {
    if (!data) {
      return [] as RentalVariable[];
    }

    const variableKeys = new Set(
      activeLenders.flatMap((lender) => lender.variableKeys)
    );

    return data.variables.filter((variable) => variableKeys.has(variable.key));
  }, [activeLenders, data]);

  const lenderResults = useMemo(() => {
    if (!data) {
      return [];
    }

    return activeLenders
      .map((lender) => ({
        lender,
        result: calculateLenderResult({
          lender,
          clientProfile,
          variableValues: aggregatedValues,
        }),
      }))
      .sort(compareResults);
  }, [activeLenders, aggregatedValues, clientProfile, data]);

  const activeLenderId =
    lenderResults.find((entry) => entry.lender.id === focusedLenderId)?.lender.id ??
    lenderResults[0]?.lender.id ??
    "";

  const selectedResult =
    lenderResults.find((entry) => entry.lender.id === activeLenderId) ??
    lenderResults[0] ??
    null;

  const updateProperty = (propertyId: string, nextValue: Partial<ClientProperty>) => {
    setProperties((current) =>
      current.map((property) =>
        property.id === propertyId ? { ...property, ...nextValue } : property
      )
    );
  };

  const updatePropertyVariable = (
    propertyId: string,
    variableKey: string,
    rawValue: string
  ) => {
    setProperties((current) =>
      current.map((property) =>
        property.id === propertyId
          ? {
              ...property,
              variableValues: {
                ...property.variableValues,
                [variableKey]: toNumber(rawValue),
              },
            }
          : property
      )
    );
  };

  const addProperty = () => {
    if (!data) {
      return;
    }

    setProperties((current) => [
      ...current,
      createEmptyProperty(data.variables, current.length + 1),
    ]);
  };

  const removeProperty = (propertyId: string) => {
    setProperties((current) =>
      current.length === 1 ? current : current.filter((property) => property.id !== propertyId)
    );
  };

  const applyScenario = (scenario: ClientScenario) => {
    const normalizedScenario = normalizeScenario(scenario);
    setClientName(normalizedScenario.clientName);
    setClientProfile(normalizedScenario.clientProfile);
    if (normalizedScenario.lenderId) {
      setFocusedLenderId(normalizedScenario.lenderId);
      setSelectedLenderIds([normalizedScenario.lenderId]);
      setCheckAllLenders(false);
    }
    setProperties(normalizedScenario.properties);
    setMessage(`Loaded ${normalizedScenario.clientName}.`);
  };

  const updateClientProfile = (nextValue: Partial<ClientProfile>) => {
    setClientProfile((current) => ({
      ...current,
      ...nextValue,
    }));
  };

  const toggleLender = (lenderId: string) => {
    setCheckAllLenders(false);
    setSelectedLenderIds((current) => {
      const next = current.includes(lenderId)
        ? current.filter((id) => id !== lenderId)
        : [...current, lenderId];

      if (!focusedLenderId || !next.includes(focusedLenderId)) {
        setFocusedLenderId(next[0] ?? "");
      }

      return next;
    });
  };

  const handleCheckAllLenders = () => {
    if (!data) {
      return;
    }

    setCheckAllLenders(true);
    setSelectedLenderIds(data.lenders.map((lender) => lender.id).filter(Boolean) as string[]);
    setFocusedLenderId(data.lenders[0]?.id ?? "");
  };

  const handleSaveScenario = async () => {
    if (!selectedResult) {
      setMessage("Create at least one lender first.");
      return;
    }

    if (!clientName.trim()) {
      setMessage("Enter a client name before saving a scenario.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      await invokeRentalApi("save_scenario", {
        scenario: {
          clientName,
          clientProfile,
          lenderId: selectedResult.lender.id,
          properties,
          summaryValue: selectedResult.result.summaryValue,
          dcr: selectedResult.result.metrics.dcr,
        },
      });
      await refreshData();
      setMessage(`Saved scenario for ${clientName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save scenario.");
    } finally {
      setIsSaving(false);
    }
  };

  const shouldShowVariable = (property: ClientProperty, variable: RentalVariable) => {
    if (!variable.dependsOnKey) {
      return true;
    }

    return (
      Number(property.variableValues[variable.dependsOnKey] ?? 0) ===
      Number(variable.dependsOnValue ?? 0)
    );
  };

  const dwellingTypeOptions: DwellingType[] =
    data?.dwellingTypes?.length
      ? data.dwellingTypes
      : [{ key: clientProfile.housingUnitType, label: clientProfile.housingUnitType, displayOrder: 0 }];

  return (
    <AppShell
      title="Live client rental calculator"
      eyebrow="Page 2"
      description="Enter one or more rental properties for the client, choose the lenders to check, and the summary updates across all selected lenders using each lender's formula set."
    >
      <section className="space-y-6">
        <div className="glass-panel rounded-[28px] p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                Saved Scenarios
              </p>
              <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                Load a previously saved client file to restore the client details and all
                saved properties.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto pb-2">
            {data?.scenarios.length ? (
              <div className="flex min-w-full gap-4">
                {data.scenarios.map((scenario) => (
                  <div
                    key={scenario.id}
                    className="w-[300px] min-w-[300px] rounded-2xl border border-[var(--line)] bg-white/75 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">{scenario.clientName}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Focused lender: {scenario.lenderName ?? "No lender selected"}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {scenario.clientProfile.addressLine1 || "No address saved"}{" "}
                          {scenario.clientProfile.city
                            ? `• ${scenario.clientProfile.city}, ${scenario.clientProfile.province}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {formatCurrency(Number(scenario.summaryValue ?? 0))}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          DCR {Number(scenario.dcr ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyScenario(scenario)}
                      className="mt-4 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)]"
                    >
                      Load client
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-7 text-[var(--muted)]">
                Save a scenario to make it reusable from this panel.
              </p>
            )}
          </div>
        </div>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="glass-panel rounded-[28px] p-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">Client name</span>
                <input
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                  placeholder="Example: Smith Family"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium">Housing unit type</span>
                <select
                  value={clientProfile.housingUnitType}
                  onChange={(event) =>
                    updateClientProfile({
                      housingUnitType: event.target.value as ClientProfile["housingUnitType"],
                    })
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                >
                  {dwellingTypeOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 lg:col-span-2">
                <span className="text-sm font-medium">Client address</span>
                <input
                  value={clientProfile.addressLine1}
                  onChange={(event) =>
                    updateClientProfile({ addressLine1: event.target.value })
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                  placeholder="123 Main Street"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium">City</span>
                <input
                  value={clientProfile.city}
                  onChange={(event) =>
                    updateClientProfile({ city: event.target.value })
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                  placeholder="Toronto"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium">Province</span>
                <select
                  value={clientProfile.province}
                  onChange={(event) =>
                    updateClientProfile({
                      province: event.target.value as ClientProfile["province"],
                    })
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                >
                  {PROVINCES.map((province) => (
                    <option key={province.code} value={province.code}>
                      {province.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium">Postal code</span>
                <input
                  value={clientProfile.postalCode}
                  onChange={(event) =>
                    updateClientProfile({ postalCode: event.target.value })
                  }
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                  placeholder="M5V 2T6"
                />
              </label>
            </div>

            <div className="mt-6 rounded-3xl border border-[var(--line)] bg-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                    Lenders To Check
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    Select one or more lenders. The property form below only asks for the
                    fields required by the lenders being checked.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCheckAllLenders}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    checkAllLenders
                      ? "bg-[var(--accent)] text-white"
                      : "border border-[var(--line)] bg-white hover:border-[var(--accent)]"
                  }`}
                >
                  Check all lenders
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {data?.lenders.length ? (
                  data.lenders.map((lender) => {
                    const isSelected =
                      checkAllLenders || (!!lender.id && selectedLenderIds.includes(lender.id));

                    return (
                      <button
                        key={lender.id}
                        type="button"
                        onClick={() => lender.id && toggleLender(lender.id)}
                        className={`rounded-full px-4 py-2 text-sm transition ${
                          isSelected
                            ? "bg-amber-100 text-amber-950 ring-1 ring-amber-300"
                            : "border border-[var(--line)] bg-white hover:border-[var(--accent)]"
                        }`}
                      >
                        {lender.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    Add lenders on the lender formulas page first.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSaveScenario}
                disabled={isSaving || !selectedResult}
                className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSaving ? "Saving..." : "Save scenario"}
              </button>
              <button
                type="button"
                onClick={addProperty}
                className="rounded-full border border-[var(--line)] px-5 py-3 text-sm transition hover:border-[var(--accent)]"
              >
                Add property
              </button>
              <button
                type="button"
                onClick={() =>
                  data ? setProperties([createEmptyProperty(data.variables, 1)]) : undefined
                }
                className="rounded-full border border-[var(--line)] px-5 py-3 text-sm transition hover:border-[var(--accent)]"
              >
                Reset properties
              </button>
            </div>

            {message ? (
              <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-3 text-sm">
                {message}
              </div>
            ) : null}
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                  Inputs
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  Enter requested client property fields
                </h2>
              </div>
              <p className="text-sm text-[var(--muted)]">
                Only the fields used by the selected lenders are shown.
              </p>
            </div>

            {isLoading ? (
              <p className="text-sm text-[var(--muted)]">Loading calculator inputs...</p>
            ) : lenderResults.length === 0 ? (
              <div className="rounded-2xl border border-[var(--line)] bg-white/75 px-4 py-6 text-sm text-[var(--muted)]">
                Select at least one lender to calculate against.
              </div>
            ) : requestedVariables.length === 0 ? (
              <div className="rounded-2xl border border-[var(--line)] bg-white/75 px-4 py-6 text-sm text-[var(--muted)]">
                The selected lenders do not currently have any client inputs attached.
              </div>
            ) : (
              <div className="space-y-4">
                {properties.map((property, propertyIndex) => (
                  <article
                    key={property.id}
                    className="rounded-[24px] border border-[var(--line)] bg-white/75 p-5"
                  >
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <label className="min-w-[220px] flex-1 space-y-2">
                        <span className="text-sm font-medium">Property name</span>
                        <input
                          value={property.name}
                          onChange={(event) =>
                            updateProperty(property.id, { name: event.target.value })
                          }
                          className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                          placeholder={`Property ${propertyIndex + 1}`}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => removeProperty(property.id)}
                        className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {requestedVariables
                        .filter((variable) => shouldShowVariable(property, variable))
                        .map((variable) => (
                          <label
                            key={`${property.id}-${variable.key}`}
                            className="rounded-2xl border border-[var(--line)] bg-white p-4"
                          >
                            <span className="block text-sm font-medium">{variable.label}</span>
                            <span className="mt-1 block text-xs leading-6 text-[var(--muted)]">
                              {variable.description}
                            </span>
                            {variable.inputKind === "boolean" ? (
                              <select
                                value={String(property.variableValues[variable.key] ?? 0)}
                                onChange={(event) =>
                                  updatePropertyVariable(
                                    property.id,
                                    variable.key,
                                    event.target.value
                                  )
                                }
                                className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                              >
                                <option value="0">No</option>
                                <option value="1">Yes</option>
                              </select>
                            ) : (
                              <input
                                type="number"
                                step={
                                  variable.inputKind === "percent"
                                    ? "0.0001"
                                    : variable.inputKind === "number"
                                      ? "1"
                                      : "0.01"
                                }
                                value={property.variableValues[variable.key] ?? 0}
                                onChange={(event) =>
                                  updatePropertyVariable(
                                    property.id,
                                    variable.key,
                                    event.target.value
                                  )
                                }
                                className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
                              />
                            )}
                          </label>
                        ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="glass-panel rounded-[28px] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent-strong)]">
              Checked Lenders Summary
            </p>
            <div className="mt-4 space-y-3">
              {lenderResults.map(({ lender, result }, index) => (
                <button
                  key={lender.id}
                  type="button"
                  onClick={() => setFocusedLenderId(lender.id ?? "")}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    selectedResult?.lender.id === lender.id
                      ? "border-[var(--accent)] bg-amber-50"
                      : "border-[var(--line)] bg-white/75 hover:border-[var(--accent)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {index + 1}. {lender.name}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {lender.notes || "No lender note saved."}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        {formatCurrency(result.summaryValue)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {isFormulaRelevant(lender, "dcr")
                          ? `DCR ${result.metrics.dcr.toFixed(2)}`
                          : "Surplus / shortfall view"}
                      </p>
                      {result.errors.length ? (
                        <p className="mt-1 text-xs text-[var(--danger)]">
                          {result.errors.length} formula issue
                          {result.errors.length === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent-strong)]">
              Selected Lender Detail
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
              {formatCurrency(selectedResult?.result.summaryValue ?? 0)}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {selectedResult?.lender.name ?? "No lender selected"}
            </p>
            {selectedResult?.result.errors.length ? (
              <div className="mt-4 rounded-2xl border border-[var(--danger)] bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
                {selectedResult.result.errors.join(" ")}
              </div>
            ) : null}
            <div className="mt-5 space-y-3 text-sm">
              {METRIC_ORDER.map((metricKey) => (
                selectedResult && isFormulaRelevant(selectedResult.lender, metricKey) ? (
                  <div
                    key={metricKey}
                    className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3"
                  >
                    <span>{metricKey.replaceAll("_", " ")}</span>
                    <strong>
                      {formatFormulaResult(
                        metricKey,
                        selectedResult.result.metrics[metricKey]
                      )}
                    </strong>
                  </div>
                ) : null
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              Formula Breakdown
            </p>
            <div className="mt-4 space-y-3">
              {selectedResult?.result.breakdown
                .filter((item) => selectedResult && isFormulaRelevant(selectedResult.lender, item.key))
                .map((item) => (
                <div
                  key={item.key}
                  className="rounded-2xl border border-[var(--line)] bg-white/70 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="mt-1 break-all font-mono text-xs leading-6 text-[var(--muted)]">
                        {item.formula}
                      </p>
                      {item.error ? (
                        <p className="mt-1 text-xs leading-6 text-[var(--danger)]">
                          {item.error}
                        </p>
                      ) : null}
                    </div>
                    <p className="font-semibold">{formatFormulaResult(item.key, item.value)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              Aggregated Totals
            </p>
            <div className="mt-4 space-y-3">
              {requestedVariables.map((variable) => (
                <div
                  key={`aggregate-${variable.key}`}
                  className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm"
                >
                  <span>{variable.label}</span>
                  <strong>
                    {formatVariableDisplay(variable, aggregatedValues[variable.key] ?? 0)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </aside>
        </section>
      </section>
    </AppShell>
  );
}
