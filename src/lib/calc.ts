import type {
  CalculationMode,
  ClientProperty,
  Lender,
  LenderRule,
  RentalVariable,
} from "@/lib/types";

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

type CalculationInput = {
  lender: Lender;
  variables: RentalVariable[];
  variableValues: Record<string, number>;
  baseLoanAmount: number;
};

type Contribution = {
  variableKey: string;
  label: string;
  amount: number;
  explanation: string;
};

type CalculationResult = {
  finalLoanAmount: number;
  totalVariableImpact: number;
  contributions: Contribution[];
};

function resolveUnsignedImpact(
  rule: LenderRule,
  variableValues: Record<string, number>
): number {
  const currentValue = variableValues[rule.variableKey] ?? 0;

  switch (rule.calculationMode) {
    case "ignore":
      return 0;
    case "value":
      return currentValue;
    case "value_times_factor":
      return currentValue * rule.factor;
    case "percent_of_reference": {
      const referenceValue = variableValues[rule.referenceVariableKey ?? ""] ?? 0;
      return currentValue * referenceValue * rule.factor;
    }
    default:
      return 0;
  }
}

function buildExplanation(rule: LenderRule, variableLabel: string): string {
  switch (rule.calculationMode) {
    case "ignore":
      return `${variableLabel} is ignored for this lender.`;
    case "value":
      return `${rule.impactDirection === "increase" ? "Adds" : "Subtracts"} the full entered value.`;
    case "value_times_factor":
      return `${rule.impactDirection === "increase" ? "Adds" : "Subtracts"} the value multiplied by ${rule.factor}.`;
    case "percent_of_reference":
      return `${rule.impactDirection === "increase" ? "Adds" : "Subtracts"} ${rule.factor} x entered rate x the referenced variable.`;
    default:
      return "";
  }
}

export function calculateLoanResult({
  lender,
  variables,
  variableValues,
  baseLoanAmount,
}: CalculationInput): CalculationResult {
  const contributions = variables.map((variable) => {
    const rule =
      lender.rules.find((item) => item.variableKey === variable.key) ??
      ({
        variableKey: variable.key,
        impactDirection: "increase",
        calculationMode: "ignore",
        factor: 1,
        referenceVariableKey: variable.defaultReferenceKey,
        notes: "",
      } satisfies LenderRule);

    const unsignedImpact = resolveUnsignedImpact(rule, variableValues);
    const amount =
      rule.impactDirection === "increase" ? unsignedImpact : -unsignedImpact;

    return {
      variableKey: variable.key,
      label: variable.label,
      amount,
      explanation: buildExplanation(rule, variable.label),
    };
  });

  const totalVariableImpact = contributions.reduce(
    (sum, contribution) => sum + contribution.amount,
    0
  );

  return {
    finalLoanAmount: Math.max(
      0,
      baseLoanAmount + lender.baseAdjustment + totalVariableImpact
    ),
    totalVariableImpact,
    contributions,
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

  return "Number";
}

export function formatFactor(
  factor: number,
  calculationMode: CalculationMode
): string {
  if (calculationMode === "ignore") {
    return "No effect";
  }

  if (calculationMode === "percent_of_reference") {
    return `Reference multiplier: ${factor}`;
  }

  return `Factor: ${factor}`;
}

export function toNumber(rawValue: string): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}
