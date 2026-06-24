import {
  calculateLenderResult,
  formatFormulaResult,
  type LenderCalculationResult,
} from "@/lib/calc";
import type {
  ClientProfile,
  Lender,
  LenderFormulaKey,
  RentalVariable,
} from "@/lib/types";

export type WorkbookExecutionMode =
  | "template-ready"
  | "protected-inputs"
  | "desktop-excel";

export type WorkbookFieldGroup = {
  id: string;
  title: string;
  description: string;
  variables: RentalVariable[];
};

export type WorkbookOutput = {
  key: LenderFormulaKey;
  label: string;
  description: string;
};

export type LenderTemplateBlueprint = {
  lender: Lender;
  templateCode: string;
  workbookName: string;
  executionMode: WorkbookExecutionMode;
  executionLabel: string;
  executionSummary: string;
  templateVersion: string;
  requiredVariables: RentalVariable[];
  groupedFields: WorkbookFieldGroup[];
  outputs: WorkbookOutput[];
  workbookChecklist: string[];
};

export type WorkbookRunResult = {
  blueprint: LenderTemplateBlueprint;
  calculation: LenderCalculationResult;
  renderedOutputs: Array<WorkbookOutput & { value: string }>;
};

const outputCatalog: WorkbookOutput[] = [
  {
    key: "surplus_shortfall",
    label: "Surplus / shortfall",
    description: "Primary comparison value surfaced back to the broker.",
  },
  {
    key: "dcr",
    label: "Debt coverage ratio",
    description: "Secondary underwriting strength signal.",
  },
  {
    key: "vacancy_amount",
    label: "Vacancy allowance",
    description: "Workbook-derived vacancy deduction used in the final math.",
  },
];

const fieldGroups: Array<{
  id: string;
  title: string;
  description: string;
  matchers: string[];
}> = [
  {
    id: "income",
    title: "Rental Income",
    description: "Values that drive subject-property and offset income.",
    matchers: ["rent", "income", "lease", "occupancy"],
  },
  {
    id: "financing",
    title: "Financing",
    description: "Payments and debt obligations the lender worksheet needs.",
    matchers: ["mortgage", "loan", "payment", "interest", "amort"],
  },
  {
    id: "expenses",
    title: "Property Expenses",
    description: "Carrying-cost inputs that usually offset qualifying rent.",
    matchers: ["tax", "condo", "fee", "expense", "heat", "utility", "maint"],
  },
  {
    id: "property",
    title: "Property Details",
    description: "Property attributes used for worksheet branching and dropdowns.",
    matchers: ["unit", "property", "address", "type", "suite"],
  },
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferExecutionMode(notes: string): WorkbookExecutionMode {
  const normalized = notes.toLowerCase();

  if (
    normalized.includes("macro") ||
    normalized.includes("desktop") ||
    normalized.includes("activex")
  ) {
    return "desktop-excel";
  }

  if (
    normalized.includes("protect") ||
    normalized.includes("locked") ||
    normalized.includes("dropdown")
  ) {
    return "protected-inputs";
  }

  return "template-ready";
}

function getExecutionCopy(mode: WorkbookExecutionMode) {
  if (mode === "desktop-excel") {
    return {
      label: "Desktop Excel worker",
      summary:
        "This lender should be treated as an Excel-automation candidate because workbook behavior may depend on macros or desktop-only features.",
    };
  }

  if (mode === "protected-inputs") {
    return {
      label: "Protected input mapping",
      summary:
        "The workbook can usually be automated by writing only to unlocked cells and validating dropdown text values before recalc.",
    };
  }

  return {
    label: "Template-ready",
    summary:
      "This lender is a good fit for direct template fill, recalc, output extraction, and completed-workbook export.",
  };
}

function getFieldGroup(variable: RentalVariable) {
  const key = `${variable.key} ${variable.label}`.toLowerCase();

  return (
    fieldGroups.find((group) =>
      group.matchers.some((matcher) => key.includes(matcher))
    ) ?? {
      id: "other",
      title: "Additional Inputs",
      description: "Lender-specific prompts that do not fit a shared category.",
    }
  );
}

function buildGroupedFields(variables: RentalVariable[]): WorkbookFieldGroup[] {
  const groups = new Map<string, WorkbookFieldGroup>();

  for (const variable of variables) {
    const group = getFieldGroup(variable);
    const existing = groups.get(group.id);

    if (existing) {
      existing.variables.push(variable);
      continue;
    }

    groups.set(group.id, {
      id: group.id,
      title: group.title,
      description: group.description,
      variables: [variable],
    });
  }

  return Array.from(groups.values());
}

export function buildLenderTemplateBlueprint(
  lender: Lender,
  variables: RentalVariable[]
): LenderTemplateBlueprint {
  const requiredVariables = variables.filter((variable) =>
    lender.variableKeys.includes(variable.key)
  );
  const executionMode = inferExecutionMode(lender.notes);
  const executionCopy = getExecutionCopy(executionMode);
  const templateCode = slugify(lender.name || lender.id || "template");

  return {
    lender,
    templateCode,
    workbookName: `${lender.name || "Lender"} Rental Worksheet`,
    executionMode,
    executionLabel: executionCopy.label,
    executionSummary: executionCopy.summary,
    templateVersion: lender.id ? "Mapped template" : "Draft template",
    requiredVariables,
    groupedFields: buildGroupedFields(requiredVariables),
    outputs: outputCatalog.filter((output) =>
      output.key === "surplus_shortfall" ||
      lender.activeFormulaKeys.includes(output.key)
    ),
    workbookChecklist: [
      "Map intake fields to unlocked workbook inputs.",
      "Write dropdown cells using approved display values, not click simulation.",
      "Recalculate before reading outputs or exporting the lender workbook.",
      executionMode === "desktop-excel"
        ? "Route this template through a Windows/Excel worker when automation is enabled."
        : "Read the final output cells and store the extracted summary values for comparison.",
    ],
  };
}

export function buildWorkbookRunResult(input: {
  lender: Lender;
  clientProfile: ClientProfile;
  variableValues: Record<string, number>;
  variables: RentalVariable[];
}): WorkbookRunResult {
  const blueprint = buildLenderTemplateBlueprint(input.lender, input.variables);
  const calculation = calculateLenderResult(input);

  return {
    blueprint,
    calculation,
    renderedOutputs: blueprint.outputs.map((output) => ({
      ...output,
      value: formatFormulaResult(
        output.key,
        calculation.metrics[output.key] ?? calculation.summaryValue
      ),
    })),
  };
}
