"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { formatFactor, formatInputKind, toNumber } from "@/lib/calc";
import { invokeRentalApi } from "@/lib/rental-api";
import type {
  BootstrapPayload,
  Lender,
  LenderRule,
  RentalVariable,
} from "@/lib/types";

function createDraftLender(): Lender {
  return {
    name: "",
    baseAdjustment: 0,
    notes: "",
    rules: [],
  };
}

export function LendersWorkspace() {
  const [variables, setVariables] = useState<RentalVariable[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [focusedLenderIndex, setFocusedLenderIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshData = async () => {
    setMessage(null);

    try {
      const data = await invokeRentalApi<BootstrapPayload>("bootstrap");
      const nextLenders = data.lenders.length > 0 ? data.lenders : [createDraftLender()];
      setVariables(data.variables);
      setLenders(nextLenders);
      setFocusedLenderIndex((current) => Math.min(current, nextLenders.length - 1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load lender data.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const data = await invokeRentalApi<BootstrapPayload>("bootstrap");

        if (cancelled) {
          return;
        }

        const nextLenders = data.lenders.length > 0 ? data.lenders : [createDraftLender()];
        setVariables(data.variables);
        setLenders(nextLenders);
        setFocusedLenderIndex(0);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Unable to load lender data."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const focusedLender = lenders[focusedLenderIndex] ?? null;

  const activeRules = useMemo(() => {
    if (!focusedLender) {
      return [];
    }

    return [...focusedLender.rules].sort((left, right) => {
      const leftOrder =
        variables.find((variable) => variable.key === left.variableKey)?.displayOrder ??
        Number.MAX_SAFE_INTEGER;
      const rightOrder =
        variables.find((variable) => variable.key === right.variableKey)?.displayOrder ??
        Number.MAX_SAFE_INTEGER;

      return leftOrder - rightOrder;
    });
  }, [focusedLender, variables]);

  const availableVariables = useMemo(() => {
    if (!focusedLender) {
      return [];
    }

    return variables.filter(
      (variable) =>
        !focusedLender.rules.some((rule) => rule.variableKey === variable.key)
    );
  }, [focusedLender, variables]);

  const updateLender = (index: number, nextValue: Partial<Lender>) => {
    setLenders((current) =>
      current.map((lender, lenderIndex) =>
        lenderIndex === index ? { ...lender, ...nextValue } : lender
      )
    );
  };

  const updateRule = (
    lenderIndex: number,
    variableKey: string,
    nextValue: Partial<LenderRule>
  ) => {
    setLenders((current) =>
      current.map((lender, index) => {
        if (index !== lenderIndex) {
          return lender;
        }

        return {
          ...lender,
          rules: lender.rules.map((rule) =>
            rule.variableKey === variableKey ? { ...rule, ...nextValue } : rule
          ),
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

  const handleAddVariable = (lenderIndex: number, variable: RentalVariable) => {
    setLenders((current) =>
      current.map((lender, index) => {
        if (index !== lenderIndex) {
          return lender;
        }

        if (lender.rules.some((rule) => rule.variableKey === variable.key)) {
          return lender;
        }

        return {
          ...lender,
          rules: [
            ...lender.rules,
            {
              variableKey: variable.key,
              impactDirection: "increase",
              calculationMode: "ignore",
              factor: 1,
              referenceVariableKey: variable.defaultReferenceKey,
              notes: "",
            },
          ],
        };
      })
    );
  };

  const handleRemoveVariable = (lenderIndex: number, variableKey: string) => {
    setLenders((current) =>
      current.map((lender, index) =>
        index === lenderIndex
          ? {
              ...lender,
              rules: lender.rules.filter((rule) => rule.variableKey !== variableKey),
            }
          : lender
      )
    );
  };

  const handleSave = async (lender: Lender, lenderIndex: number) => {
    if (!lender.name.trim()) {
      setMessage("Each lender needs a name before it can be saved.");
      return;
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

  return (
    <AppShell
      title="Lender-by-lender rental criteria"
      eyebrow="Page 1"
      description="Use the lender list on the left to move between lenders, then define the variables and rule behavior for the currently selected lender."
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
              This list comes from the database. Select a lender to manage its variables,
              calculation directions, factors, and notes.
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
                    {lender.rules.length} active variable
                    {lender.rules.length === 1 ? "" : "s"}
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
              Loading lender rules...
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

              <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_160px]">
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

                <label className="space-y-2">
                  <span className="text-sm font-medium">Base adjustment</span>
                  <input
                    type="number"
                    step="0.01"
                    value={focusedLender.baseAdjustment}
                    onChange={(event) =>
                      updateLender(focusedLenderIndex, {
                        baseAdjustment: toNumber(event.target.value),
                      })
                    }
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
                  placeholder="Optional guidance for this lender."
                />
              </label>

              <div className="mt-6 rounded-3xl border border-[var(--line)] bg-white/70 p-4">
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
                  Available Variables
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                  Add variables for the currently selected lender. Removed variables return to
                  this list.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {availableVariables.length > 0 ? (
                    availableVariables.map((variable) => (
                      <button
                        key={variable.key}
                        type="button"
                        onClick={() => handleAddVariable(focusedLenderIndex, variable)}
                        className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                      >
                        Add {variable.label}
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--muted)]">
                      All catalog variables are already active for this lender.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                      <th className="pb-2">Variable</th>
                      <th className="pb-2">Direction</th>
                      <th className="pb-2">Mode</th>
                      <th className="pb-2">Factor</th>
                      <th className="pb-2">Reference</th>
                      <th className="pb-2">Notes</th>
                      <th className="pb-2">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRules.length > 0 ? (
                      activeRules.map((rule) => {
                        const variable = variables.find(
                          (item) => item.key === rule.variableKey
                        );

                        if (!variable) {
                          return null;
                        }

                        return (
                          <tr key={variable.key}>
                            <td className="rounded-l-2xl border-y border-l border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <p className="font-medium">{variable.label}</p>
                              <p className="mt-1 text-xs leading-6 text-[var(--muted)]">
                                {variable.description}
                              </p>
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                {formatInputKind(variable.inputKind)}
                              </p>
                            </td>
                            <td className="border-y border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <select
                                value={rule.impactDirection}
                                onChange={(event) =>
                                  updateRule(focusedLenderIndex, variable.key, {
                                    impactDirection:
                                      event.target.value as LenderRule["impactDirection"],
                                  })
                                }
                                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
                              >
                                <option value="increase">Increase</option>
                                <option value="decrease">Decrease</option>
                              </select>
                            </td>
                            <td className="border-y border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <select
                                value={rule.calculationMode}
                                onChange={(event) =>
                                  updateRule(focusedLenderIndex, variable.key, {
                                    calculationMode:
                                      event.target.value as LenderRule["calculationMode"],
                                  })
                                }
                                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
                              >
                                <option value="ignore">Ignore</option>
                                <option value="value">Raw value</option>
                                <option value="value_times_factor">Value x factor</option>
                                <option value="percent_of_reference">
                                  Percent of reference
                                </option>
                              </select>
                            </td>
                            <td className="border-y border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <input
                                type="number"
                                step="0.0001"
                                value={rule.factor}
                                onChange={(event) =>
                                  updateRule(focusedLenderIndex, variable.key, {
                                    factor: toNumber(event.target.value),
                                  })
                                }
                                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
                              />
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                {formatFactor(rule.factor, rule.calculationMode)}
                              </p>
                            </td>
                            <td className="border-y border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <select
                                value={rule.referenceVariableKey ?? ""}
                                onChange={(event) =>
                                  updateRule(focusedLenderIndex, variable.key, {
                                    referenceVariableKey: event.target.value || null,
                                  })
                                }
                                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
                              >
                                <option value="">None</option>
                                {variables.map((reference) => (
                                  <option key={reference.key} value={reference.key}>
                                    {reference.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="border-y border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <textarea
                                value={rule.notes ?? ""}
                                onChange={(event) =>
                                  updateRule(focusedLenderIndex, variable.key, {
                                    notes: event.target.value,
                                  })
                                }
                                rows={2}
                                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
                                placeholder="Optional note"
                              />
                            </td>
                            <td className="rounded-r-2xl border-y border-r border-[var(--line)] bg-white/75 px-4 py-3 align-top">
                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveVariable(focusedLenderIndex, variable.key)
                                }
                                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm transition hover:border-[var(--danger)] hover:text-[var(--danger)]"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="rounded-2xl border border-[var(--line)] bg-white/75 px-4 py-6 text-sm text-[var(--muted)]"
                        >
                          No variables added yet. Use the available variables list above to
                          add them for this lender.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-3">
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
    </AppShell>
  );
}
