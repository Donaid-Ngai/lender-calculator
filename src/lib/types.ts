export type InputKind = "currency" | "percent" | "number" | "boolean";

export type ProvinceCode =
  | "AB"
  | "BC"
  | "MB"
  | "NB"
  | "NL"
  | "NS"
  | "NT"
  | "NU"
  | "ON"
  | "PE"
  | "QC"
  | "SK"
  | "YT";

export type LenderFormulaKey =
  | "vacancy_rate"
  | "economic_rent"
  | "maintenance"
  | "vacancy_amount"
  | "surplus_shortfall"
  | "dcr";

export type RentalVariableKey = string;

export type FormulaPlaceholderKey =
  | RentalVariableKey
  | LenderFormulaKey
  | "provincial_vacancy_rate"
  | "dwelling_type_percentage";

export type RentalVariable = {
  key: RentalVariableKey;
  label: string;
  description: string;
  inputKind: InputKind;
  dependsOnKey: string | null;
  dependsOnValue: number | null;
  displayOrder: number;
};

export type DwellingType = {
  key: string;
  label: string;
  displayOrder: number;
};

export type LenderFormulas = Record<LenderFormulaKey, string>;

export type ProvinceVacancyRates = Partial<Record<ProvinceCode, number>>;

export type Lender = {
  id?: string;
  name: string;
  notes: string;
  variableKeys: RentalVariableKey[];
  activeFormulaKeys: LenderFormulaKey[];
  provinceVacancyRates: ProvinceVacancyRates;
  dwellingTypePercentages: Record<string, number>;
  formulas: LenderFormulas;
};

export type ClientProperty = {
  id: string;
  name: string;
  variableValues: Record<string, number>;
};

export type HousingUnitType = string;

export type ClientProfile = {
  addressLine1: string;
  city: string;
  province: ProvinceCode;
  postalCode: string;
  housingUnitType: HousingUnitType;
};

export type ClientScenario = {
  id: string;
  lenderId: string | null;
  lenderName: string | null;
  clientName: string;
  clientProfile: ClientProfile;
  properties: ClientProperty[];
  summaryValue: number;
  dcr: number;
  updatedAt: string;
};

export type BootstrapPayload = {
  variables: RentalVariable[];
  dwellingTypes: DwellingType[];
  lenders: Lender[];
  scenarios: ClientScenario[];
};
