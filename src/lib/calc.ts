import type {
  ClientProperty,
  ClientProfile,
  Lender,
  LenderFormulaKey,
  ProvinceCode,
  RentalVariable,
} from "@/lib/types";

export const FORMULA_SEQUENCE: LenderFormulaKey[] = [
  "vacancy_rate",
  "economic_rent",
  "maintenance",
  "vacancy_amount",
  "surplus_shortfall",
  "dcr",
];

export const FORMULA_LABELS: Record<LenderFormulaKey, string> = {
  vacancy_rate: "Vacancy rate %",
  economic_rent: "Economic rent",
  maintenance: "Maintenance",
  vacancy_amount: "Vacancy $",
  surplus_shortfall: "Surplus / shortfall",
  dcr: "DCR",
};

export const DEFAULT_FORMULAS: Record<LenderFormulaKey, string> = {
  vacancy_rate: "provincial_vacancy_rate",
  economic_rent: "economic_rent_amount",
  maintenance: "gross_monthly_rent * 0.15",
  vacancy_amount: "gross_monthly_rent * vacancy_rate",
  surplus_shortfall:
    "gross_monthly_rent + other_monthly_rent - monthly_mortgage_payment - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount",
  dcr:
    "(gross_monthly_rent + other_monthly_rent - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount) / monthly_mortgage_payment",
};

export const DEFAULT_ACTIVE_FORMULA_KEYS: LenderFormulaKey[] = ["surplus_shortfall"];

const ALLOWED_FORMULA_PATTERN = /^[\d\s()+\-*/._a-zA-Z]+$/;
const IDENTIFIER_PATTERN = /[a-zA-Z_][a-zA-Z0-9_]*/g;

export const PROVINCES: Array<{ code: ProvinceCode; label: string }> = [
  { code: "AB", label: "Alberta" },
  { code: "BC", label: "British Columbia" },
  { code: "MB", label: "Manitoba" },
  { code: "NB", label: "New Brunswick" },
  { code: "NL", label: "Newfoundland and Labrador" },
  { code: "NS", label: "Nova Scotia" },
  { code: "NT", label: "Northwest Territories" },
  { code: "NU", label: "Nunavut" },
  { code: "ON", label: "Ontario" },
  { code: "PE", label: "Prince Edward Island" },
  { code: "QC", label: "Quebec" },
  { code: "SK", label: "Saskatchewan" },
  { code: "YT", label: "Yukon" },
];

export const HOUSING_UNIT_TYPE_OPTIONS: Array<{
  value: ClientProfile["housingUnitType"];
  label: string;
}> = [];

const FORMULA_RESULT_PLACEHOLDERS: Array<{
  key: LenderFormulaKey | "provincial_vacancy_rate" | "dwelling_type_percentage";
  label: string;
}> = [
  { key: "provincial_vacancy_rate", label: "Provincial vacancy rate" },
  { key: "dwelling_type_percentage", label: "Dwelling type percentage" },
  { key: "vacancy_rate", label: "Vacancy rate result" },
  { key: "economic_rent", label: "Economic rent result" },
  { key: "maintenance", label: "Maintenance result" },
  { key: "vacancy_amount", label: "Vacancy dollar result" },
  { key: "surplus_shortfall", label: "Surplus/shortfall result" },
  { key: "dcr", label: "DCR result" },
];

export const DEFAULT_CLIENT_PROFILE: ClientProfile = {
  addressLine1: "",
  city: "",
  province: "ON",
  postalCode: "",
  housingUnitType: "single_family",
};

function createLocalId(prefix: string): string {
  if (
    typeof globalThis !== "undefined" &&
    "crypto" in globalThis &&
    typeof globalThis.crypto?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getAllowedFormulaIdentifiers(
  variables: RentalVariable[]
): Set<string> {
  return new Set([
    ...variables.map((variable) => variable.key),
    ...FORMULA_SEQUENCE,
    "provincial_vacancy_rate",
    "dwelling_type_percentage",
  ]);
}

export function validateFormula(
  formula: string,
  variables: RentalVariable[]
): string | null {
  const normalized = formula.trim();

  if (!normalized) {
    return "Formula is required.";
  }

  if (!ALLOWED_FORMULA_PATTERN.test(normalized)) {
    return "Use only numbers, variable names, spaces, parentheses, and + - * /.";
  }

  const allowedIdentifiers = getAllowedFormulaIdentifiers(variables);
  const identifiers = extractFormulaIdentifiers(normalized);

  for (const identifier of identifiers) {
    if (!allowedIdentifiers.has(identifier)) {
      return `Unknown formula field: ${identifier}.`;
    }
  }

  return null;
}

export function extractFormulaIdentifiers(formula: string): string[] {
  return Array.from(new Set(formula.match(IDENTIFIER_PATTERN) ?? []));
}

type FormulaContext = Record<string, number>;

export function buildFormulaPlaceholders(
  variables: RentalVariable[]
): Array<{ key: string; label: string }> {
  return [
    ...variables.map((variable) => ({
      key: variable.key,
      label: variable.label,
    })),
    ...FORMULA_RESULT_PLACEHOLDERS,
  ];
}

function evaluateFormula(formula: string, context: FormulaContext): number {
  if (!formula.trim()) {
    throw new Error("Formula is required.");
  }

  if (!ALLOWED_FORMULA_PATTERN.test(formula.trim())) {
    throw new Error(
      "Use only numbers, variable names, spaces, parentheses, and + - * /."
    );
  }

  const identifiers = extractFormulaIdentifiers(formula);

  for (const identifier of identifiers) {
    if (!(identifier in context)) {
      throw new Error(`Unknown formula field: ${identifier}.`);
    }
  }

  const evaluator = new Function(
    ...identifiers,
    `"use strict"; return (${formula});`
  ) as (...values: number[]) => number;
  const values = identifiers.map((identifier) => context[identifier as keyof FormulaContext] ?? 0);
  const result = evaluator(...values);

  return Number.isFinite(result) ? result : 0;
}

export type FormulaMetricResult = {
  key: LenderFormulaKey;
  label: string;
  formula: string;
  value: number;
  error?: string;
};

export type LenderCalculationResult = {
  summaryValue: number;
  metrics: Record<LenderFormulaKey, number>;
  breakdown: FormulaMetricResult[];
  errors: string[];
};

export function isFormulaRelevant(
  lender: Lender,
  formulaKey: LenderFormulaKey
): boolean {
  return (
    formulaKey === "surplus_shortfall" ||
    (lender.activeFormulaKeys ?? DEFAULT_ACTIVE_FORMULA_KEYS).includes(formulaKey)
  );
}

type CalculationInput = {
  lender: Lender;
  clientProfile: ClientProfile;
  variableValues: Record<string, number>;
};

export function calculateLenderResult({
  lender,
  clientProfile,
  variableValues,
}: CalculationInput): LenderCalculationResult {
  const provincialVacancyRate =
    lender.provinceVacancyRates?.[clientProfile.province] ?? 0;
  const context = {
    ...variableValues,
    provincial_vacancy_rate: provincialVacancyRate,
    dwelling_type_percentage:
      lender.dwellingTypePercentages?.[clientProfile.housingUnitType] ?? 0,
    vacancy_rate: 0,
    economic_rent: 0,
    maintenance: 0,
    vacancy_amount: 0,
    surplus_shortfall: 0,
    dcr: 0,
  } as FormulaContext;
  const breakdown: FormulaMetricResult[] = [];
  const errors: string[] = [];

  for (const formulaKey of FORMULA_SEQUENCE) {
    const shouldEvaluate = isFormulaRelevant(lender, formulaKey);
    const formula = lender.formulas[formulaKey];
    let value = 0;
    let error: string | undefined;

    if (shouldEvaluate) {
      try {
        value = evaluateFormula(formula, context);
      } catch (caughtError) {
        error =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to evaluate formula.";
        errors.push(`${FORMULA_LABELS[formulaKey]}: ${error}`);
      }
    }

    context[formulaKey] = value;
    breakdown.push({
      key: formulaKey,
      label: FORMULA_LABELS[formulaKey],
      formula: shouldEvaluate ? formula : "",
      value,
      error,
    });
  }

  return {
    summaryValue: context.surplus_shortfall ?? 0,
    metrics: {
      vacancy_rate: context.vacancy_rate ?? 0,
      economic_rent: context.economic_rent ?? 0,
      maintenance: context.maintenance ?? 0,
      vacancy_amount: context.vacancy_amount ?? 0,
      surplus_shortfall: context.surplus_shortfall ?? 0,
      dcr: context.dcr ?? 0,
    },
    breakdown,
    errors,
  };
}

export function createEmptyProperty(
  variables: RentalVariable[],
  index: number
): ClientProperty {
  return {
    id: createLocalId("property"),
    name: `Property ${index}`,
    variableValues: Object.fromEntries(variables.map((variable) => [variable.key, 0])),
  };
}

export function aggregatePropertyValues(
  properties: ClientProperty[],
  variables: RentalVariable[]
): Record<string, number> {
  return Object.fromEntries(
    variables.map((variable) => [
      variable.key,
      properties.reduce(
        (sum, property) => sum + (property.variableValues[variable.key] ?? 0),
        0
      ),
    ])
  );
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function formatPercentDisplay(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function formatInputKind(inputKind: RentalVariable["inputKind"]): string {
  if (inputKind === "currency") {
    return "Currency";
  }

  if (inputKind === "percent") {
    return "Percent";
  }

  if (inputKind === "boolean") {
    return "Yes / No";
  }

  return "Number";
}

export function formatVariableDisplay(
  variable: RentalVariable,
  value: number
): string {
  if (variable.inputKind === "currency") {
    return formatCurrency(value);
  }

  if (variable.inputKind === "percent") {
    return formatPercentDisplay(value);
  }

  if (variable.inputKind === "boolean") {
    return value ? "Yes" : "No";
  }

  return value.toLocaleString("en-CA");
}

export function formatFormulaResult(
  key: LenderFormulaKey,
  value: number
): string {
  if (key === "vacancy_rate") {
    return formatPercentDisplay(value);
  }

  if (key === "dcr") {
    return value.toFixed(2);
  }

  return formatCurrency(value);
}

export function toNumber(rawValue: string): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}
