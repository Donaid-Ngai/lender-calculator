"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  aggregatePropertyValues,
  calculateLoanResult,
  createEmptyProperty,
  formatCurrency,
  formatPercentDisplay,
  toNumber,
} from "@/lib/calc";
import { invokeRentalApi } from "@/lib/rental-api";
import type {
  BootstrapPayload,
  ClientProperty,
  ClientScenario,
} from "@/lib/types";

type CalculatorWorkspaceProps = {
  initialData: BootstrapPayload;
};

export function CalculatorWorkspace({ initialData }: CalculatorWorkspaceProps) {
  const [data, setData] = useState<BootstrapPayload | null>(initialData);
  const [focusedLenderId, setFocusedLenderId] = useState<string>(
    initialData.lenders[0]?.id ?? ""
  );
  const [selectedLenderIds, setSelectedLenderIds] = useState<string[]>(
    initialData.lenders.map((lender) => lender.id).filter(Boolean) as string[]
  );
  const [checkAllLenders, setCheckAllLenders] = useState(true);
  const [clientName, setClientName] = useState("");
  const [baseLoanAmount, setBaseLoanAmount] = useState(0);
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
      setData(nextData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load calculator data.");
    } finally {
      setIsLoading(false);
    }
  };

  const aggregatedValues = useMemo(() => {
    if (!data) {
      return {};
    }

    return aggregatePropertyValues(properties, data.variables);
  }, [data, properties]);

  const requestedVariables = useMemo(() => {
    if (!data) {
      return [];
    }

    const activeLenders = checkAllLenders
      ? data.lenders
      : data.lenders.filter((lender) => lender.id && selectedLenderIds.includes(lender.id));

    const variableKeys = new Set(
      activeLenders.flatMap((lender) => lender.rules.map((rule) => rule.variableKey))
    );

    return data.variables.filter((variable) => variableKeys.has(variable.key));
  }, [checkAllLenders, data, selectedLenderIds]);

  const lenderResults = useMemo(() => {
    if (!data) {
      return [];
    }

    const activeLenders = checkAllLenders
      ? data.lenders
      : data.lenders.filter((lender) => lender.id && selectedLenderIds.includes(lender.id));

    return activeLenders
      .map((lender) => ({
        lender,
        result: calculateLoanResult({
          lender,
          variables: data.variables,
          variableValues: aggregatedValues,
          baseLoanAmount,
        }),
      }))
      .sort((left, right) => right.result.finalLoanAmount - left.result.finalLoanAmount);
  }, [aggregatedValues, baseLoanAmount, checkAllLenders, data, selectedLenderIds]);

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
    setClientName(scenario.clientName);
    setBaseLoanAmount(scenario.baseLoanAmount);
    if (scenario.lenderId) {
      setFocusedLenderId(scenario.lenderId);
      setSelectedLenderIds([scenario.lenderId]);
      setCheckAllLenders(false);
    }
    setProperties(scenario.properties);
    setMessage(`Loaded ${scenario.clientName}.`);
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
          lenderId: selectedResult.lender.id,
          baseLoanAmount,
          properties,
          calculatedLoanAmount: selectedResult.result.finalLoanAmount,
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

  return (
    <AppShell
      title="Live client lending calculator"
      eyebrow="Page 2"
      description="Enter one or more rental properties for the client and the app automatically rolls everything up across all configured lenders. The summary updates live as you change any property input."
    >
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
                <span className="text-sm font-medium">Base loan amount</span>
                <input
                  type="number"
                  step="0.01"
                  value={baseLoanAmount}
                  onChange={(event) => setBaseLoanAmount(toNumber(event.target.value))}
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
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
                    Select one or more lenders. The property form below will only ask for variables those lenders actually use.
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
                    Add lenders on the lender criteria page first.
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
                The visible fields are the union of variables used by the lenders you selected above.
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
                The selected lenders do not currently have any variables attached. Add variables on the lender criteria page first.
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
                      {requestedVariables.map((variable) => (
                        <label
                          key={`${property.id}-${variable.key}`}
                          className="rounded-2xl border border-[var(--line)] bg-white p-4"
                        >
                          <span className="block text-sm font-medium">{variable.label}</span>
                          <span className="mt-1 block text-xs leading-6 text-[var(--muted)]">
                            {variable.description}
                          </span>
                          <input
                            type="number"
                            step={variable.inputKind === "percent" ? "0.0001" : "0.01"}
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
                        {formatCurrency(result.finalLoanAmount)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Impact {formatCurrency(result.totalVariableImpact)}
                      </p>
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
              {formatCurrency(selectedResult?.result.finalLoanAmount ?? 0)}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {selectedResult?.lender.name ?? "No lender selected"}
            </p>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
                <span>Base loan amount</span>
                <strong>{formatCurrency(baseLoanAmount)}</strong>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
                <span>Lender base adjustment</span>
                <strong>
                  {formatCurrency(selectedResult?.lender.baseAdjustment ?? 0)}
                </strong>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3">
                <span>Total rule impact</span>
                <strong>
                  {formatCurrency(selectedResult?.result.totalVariableImpact ?? 0)}
                </strong>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              Contribution Breakdown
            </p>
            <div className="mt-4 space-y-3">
              {selectedResult?.result.contributions.map((contribution) => (
                <div
                  key={contribution.variableKey}
                  className="rounded-2xl border border-[var(--line)] bg-white/70 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{contribution.label}</p>
                      <p className="mt-1 text-xs leading-6 text-[var(--muted)]">
                        {contribution.explanation}
                      </p>
                    </div>
                    <p
                      className={`font-semibold ${
                        contribution.amount >= 0
                          ? "text-[var(--success)]"
                          : "text-[var(--danger)]"
                      }`}
                    >
                      {formatCurrency(contribution.amount)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              Saved Scenarios
            </p>
            <div className="mt-4 space-y-3">
              {data?.scenarios.length ? (
                data.scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => applyScenario(scenario)}
                    className="w-full rounded-2xl border border-[var(--line)] bg-white/75 p-4 text-left transition hover:border-[var(--accent)]"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{scenario.clientName}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Best current lender: {scenario.lenderName ?? "No lender selected"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {formatCurrency(scenario.calculatedLoanAmount)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {new Date(scenario.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-sm leading-7 text-[var(--muted)]">
                  Save a scenario to make it reusable from this panel.
                </p>
              )}
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
                    {variable.inputKind === "percent"
                      ? formatPercentDisplay(aggregatedValues[variable.key] ?? 0)
                      : formatCurrency(aggregatedValues[variable.key] ?? 0)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
