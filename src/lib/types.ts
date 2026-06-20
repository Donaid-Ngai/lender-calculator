export type InputKind = "currency" | "percent" | "number";

export type CalculationMode =
  | "ignore"
  | "value"
  | "value_times_factor"
  | "percent_of_reference";

export type ImpactDirection = "increase" | "decrease";

export type RentalVariable = {
  key: string;
  label: string;
  description: string;
  inputKind: InputKind;
  defaultReferenceKey: string | null;
  displayOrder: number;
};

export type LenderRule = {
  variableKey: string;
  impactDirection: ImpactDirection;
  calculationMode: CalculationMode;
  factor: number;
  referenceVariableKey: string | null;
  notes: string;
};

export type Lender = {
  id?: string;
  name: string;
  baseAdjustment: number;
  notes: string;
  rules: LenderRule[];
};

export type ClientProperty = {
  id: string;
  name: string;
  variableValues: Record<string, number>;
};

export type ClientScenario = {
  id: string;
  lenderId: string | null;
  lenderName: string | null;
  clientName: string;
  baseLoanAmount: number;
  properties: ClientProperty[];
  calculatedLoanAmount: number;
  updatedAt: string;
};

export type BootstrapPayload = {
  variables: RentalVariable[];
  lenders: Lender[];
  scenarios: ClientScenario[];
};
