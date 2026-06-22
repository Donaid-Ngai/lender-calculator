import postgres from "npm:postgres@3.4.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const connectionString = Deno.env.get("SUPABASE_DB_URL");

if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is not configured.");
}

const sql = postgres(connectionString, { prepare: false });

const defaultFormulas = {
  vacancy_rate: "provincial_vacancy_rate",
  economic_rent: "economic_rent_amount",
  maintenance: "gross_monthly_rent * 0.15",
  vacancy_amount: "gross_monthly_rent * vacancy_rate",
  surplus_shortfall:
    "gross_monthly_rent + other_monthly_rent - monthly_mortgage_payment - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount",
  dcr:
    "(gross_monthly_rent + other_monthly_rent - monthly_property_taxes - monthly_condo_fees - other_expenses - maintenance - vacancy_amount) / monthly_mortgage_payment",
} as const;

type IncomingRequest = {
  action?: string;
  payload?: Record<string, unknown>;
};

const defaultClientProfile = {
  addressLine1: "",
  city: "",
  province: "ON",
  postalCode: "",
  housingUnitType: "single_family",
} as const;

type PersistedLender = {
  id?: string;
  name: string;
  notes: string;
  variableKeys: string[];
  activeFormulaKeys: string[];
  provinceVacancyRates: Record<string, number>;
  dwellingTypePercentages: Record<string, number>;
  formulas: {
    vacancy_rate: string;
    economic_rent: string;
    maintenance: string;
    vacancy_amount: string;
    surplus_shortfall: string;
    dcr: string;
  };
};

type PersistedVariable = {
  key: string;
  label: string;
  description?: string;
  inputKind: "currency" | "percent" | "number" | "boolean";
  dependsOnKey?: string | null;
  dependsOnValue?: number | null;
  displayOrder: number;
};

type PersistedDwellingType = {
  key: string;
  label: string;
  displayOrder: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function invalid(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return value as T;
}

async function bootstrap() {
  const variables = await sql`
    select
      key,
      label,
      coalesce(description, '') as description,
      input_kind as "inputKind",
      depends_on_key as "dependsOnKey",
      depends_on_value as "dependsOnValue",
      display_order as "displayOrder"
    from rental_lending.variables
    order by display_order asc
  `;

  const dwellingTypes = await sql`
    select
      key,
      label,
      display_order as "displayOrder"
    from rental_lending.dwelling_types
    order by display_order asc, label asc
  `;

  const lenderRows = await sql`
    select
      l.id,
      l.name,
      coalesce(l.notes, '') as notes,
      coalesce(l.active_formula_keys, '["surplus_shortfall"]'::jsonb) as "activeFormulaKeys",
      coalesce(l.province_vacancy_rates, '{}'::jsonb) as "provinceVacancyRates",
      coalesce(l.dwelling_type_percentages, '{}'::jsonb) as "dwellingTypePercentages",
      coalesce(
        array_agg(lv.variable_key order by v.display_order)
          filter (where lv.variable_key is not null),
        '{}'::text[]
      ) as "variableKeys",
      json_build_object(
        'vacancy_rate', coalesce(l.vacancy_rate_formula, ${defaultFormulas.vacancy_rate}),
        'economic_rent', coalesce(l.economic_rent_formula, ${defaultFormulas.economic_rent}),
        'maintenance', coalesce(l.maintenance_formula, ${defaultFormulas.maintenance}),
        'vacancy_amount', coalesce(l.vacancy_amount_formula, ${defaultFormulas.vacancy_amount}),
        'surplus_shortfall', coalesce(l.surplus_shortfall_formula, ${defaultFormulas.surplus_shortfall}),
        'dcr', coalesce(l.dcr_formula, ${defaultFormulas.dcr})
      ) as formulas
    from rental_lending.lenders l
    left join rental_lending.lender_variables lv on lv.lender_id = l.id
    left join rental_lending.variables v on v.key = lv.variable_key
    group by l.id
    order by l.updated_at desc, l.name asc
  `;

  const lenders = lenderRows.map((lender) => ({
    ...lender,
    provinceVacancyRates: parseJsonValue<Record<string, number>>(
      lender.provinceVacancyRates,
      {}
    ),
    dwellingTypePercentages: parseJsonValue<Record<string, number>>(
      lender.dwellingTypePercentages,
      {}
    ),
    activeFormulaKeys: Array.isArray(parseJsonValue<string[]>(lender.activeFormulaKeys, []))
      ? parseJsonValue<string[]>(lender.activeFormulaKeys, [])
      : ["surplus_shortfall"],
    formulas: {
      vacancy_rate: lender.formulas?.vacancy_rate ?? "provincial_vacancy_rate",
      economic_rent: lender.formulas?.economic_rent ?? defaultFormulas.economic_rent,
      maintenance: lender.formulas?.maintenance ?? defaultFormulas.maintenance,
      vacancy_amount: lender.formulas?.vacancy_amount ?? defaultFormulas.vacancy_amount,
      surplus_shortfall:
        lender.formulas?.surplus_shortfall ?? defaultFormulas.surplus_shortfall,
      dcr: lender.formulas?.dcr ?? defaultFormulas.dcr,
    },
  }));

  const scenarioRows = await sql`
    select
      s.id,
      s.lender_id as "lenderId",
      l.name as "lenderName",
      s.client_name as "clientName",
      s.variable_values as "variableValues",
      s.summary_value as "summaryValue",
      s.dcr,
      s.updated_at as "updatedAt"
    from rental_lending.client_scenarios s
    left join rental_lending.lenders l on l.id = s.lender_id
    order by s.updated_at desc
    limit 8
  `;

  const scenarios = scenarioRows.map((scenario) => {
    const parsedValues =
      typeof scenario.variableValues === "string"
        ? JSON.parse(scenario.variableValues)
        : scenario.variableValues;
    const storedValues = (
      parsedValues as {
        clientProfile?: Record<string, unknown>;
        properties?: unknown[];
      }
    ) ?? {};

    return {
      id: scenario.id,
      lenderId: scenario.lenderId,
      lenderName: scenario.lenderName,
      clientName: scenario.clientName,
      clientProfile: {
        ...defaultClientProfile,
        ...(storedValues.clientProfile ?? {}),
      },
      summaryValue: Number(scenario.summaryValue ?? 0),
      dcr: Number(scenario.dcr ?? 0),
      updatedAt: scenario.updatedAt,
      properties: Array.isArray(storedValues.properties) ? storedValues.properties : [],
    };
  });

  return { variables, dwellingTypes, lenders, scenarios };
}

async function saveLender(lender: PersistedLender) {
  if (!lender.name?.trim()) {
    throw new Error("Lender name is required.");
  }

  await sql.begin(async (tx) => {
    let lenderId = lender.id;

    if (lenderId) {
      const updated = await tx`
        update rental_lending.lenders
        set
          name = ${lender.name.trim()},
          notes = ${lender.notes ?? ""},
          active_formula_keys = ${JSON.stringify(
            lender.activeFormulaKeys?.length
              ? Array.from(new Set(["surplus_shortfall", ...lender.activeFormulaKeys]))
              : ["surplus_shortfall"]
          )}::jsonb,
          province_vacancy_rates = ${JSON.stringify(
            lender.provinceVacancyRates ?? {}
          )}::jsonb,
          dwelling_type_percentages = ${JSON.stringify(
            lender.dwellingTypePercentages ?? {}
          )}::jsonb,
          vacancy_rate_formula = ${lender.formulas.vacancy_rate ?? defaultFormulas.vacancy_rate},
          economic_rent_formula = ${lender.formulas.economic_rent ?? defaultFormulas.economic_rent},
          maintenance_formula = ${lender.formulas.maintenance ?? defaultFormulas.maintenance},
          vacancy_amount_formula = ${lender.formulas.vacancy_amount ?? defaultFormulas.vacancy_amount},
          surplus_shortfall_formula = ${lender.formulas.surplus_shortfall ?? defaultFormulas.surplus_shortfall},
          dcr_formula = ${lender.formulas.dcr ?? defaultFormulas.dcr}
        where id = ${lenderId}
        returning id
      `;

      if (updated.length === 0) {
        throw new Error("Lender not found or access denied.");
      }
    } else {
      const inserted = await tx`
        insert into rental_lending.lenders (
          name,
          notes,
          active_formula_keys,
          province_vacancy_rates,
          dwelling_type_percentages,
          vacancy_rate_formula,
          economic_rent_formula,
          maintenance_formula,
          vacancy_amount_formula,
          surplus_shortfall_formula,
          dcr_formula
        )
        values (
          ${lender.name.trim()},
          ${lender.notes ?? ""},
          ${JSON.stringify(
            lender.activeFormulaKeys?.length
              ? Array.from(new Set(["surplus_shortfall", ...lender.activeFormulaKeys]))
              : ["surplus_shortfall"]
          )}::jsonb,
          ${JSON.stringify(
            lender.provinceVacancyRates ?? {}
          )}::jsonb,
          ${JSON.stringify(
            lender.dwellingTypePercentages ?? {}
          )}::jsonb,
          ${lender.formulas.vacancy_rate ?? defaultFormulas.vacancy_rate},
          ${lender.formulas.economic_rent ?? defaultFormulas.economic_rent},
          ${lender.formulas.maintenance ?? defaultFormulas.maintenance},
          ${lender.formulas.vacancy_amount ?? defaultFormulas.vacancy_amount},
          ${lender.formulas.surplus_shortfall ?? defaultFormulas.surplus_shortfall},
          ${lender.formulas.dcr ?? defaultFormulas.dcr}
        )
        returning id
      `;

      lenderId = inserted[0].id as string;
    }

    await tx`
      delete from rental_lending.lender_variables
      where lender_id = ${lenderId}
    `;

    for (const variableKey of lender.variableKeys ?? []) {
      await tx`
        insert into rental_lending.lender_variables (
          lender_id,
          variable_key
        )
        values (
          ${lenderId},
          ${variableKey}
        )
      `;
    }
  });
}

async function deleteLender(lenderId: string) {
  await sql`
    delete from rental_lending.lenders
    where id = ${lenderId}
  `;
}

async function saveVariable(variable: PersistedVariable) {
  if (!variable.key?.trim()) {
    throw new Error("Input key is required.");
  }

  if (!variable.label?.trim()) {
    throw new Error("Input label is required.");
  }

  await sql`
    insert into rental_lending.variables (
      key,
      label,
      description,
      input_kind,
      depends_on_key,
      depends_on_value,
      display_order
    )
    values (
      ${variable.key.trim()},
      ${variable.label.trim()},
      ${variable.description?.trim() ?? ""},
      ${variable.inputKind},
      ${variable.dependsOnKey?.trim() || null},
      ${variable.dependsOnValue ?? null},
      ${variable.displayOrder ?? 0}
    )
    on conflict (key) do update
    set
      label = excluded.label,
      description = excluded.description,
      input_kind = excluded.input_kind,
      depends_on_key = excluded.depends_on_key,
      depends_on_value = excluded.depends_on_value,
      display_order = excluded.display_order
  `;
}

async function deleteVariable(variableKey: string) {
  const lendersUsingVariable = await sql`
    select count(*)::int as count
    from rental_lending.lender_variables
    where variable_key = ${variableKey}
  `;

  if ((lendersUsingVariable[0]?.count ?? 0) > 0) {
    throw new Error("Remove this input from lenders before deleting it.");
  }

  const formulaPattern = `(^|[^a-zA-Z0-9_])${variableKey}([^a-zA-Z0-9_]|$)`;
  const lendersUsingFormula = await sql`
    select count(*)::int as count
    from rental_lending.lenders
    where vacancy_rate_formula ~ ${formulaPattern}
      or economic_rent_formula ~ ${formulaPattern}
      or maintenance_formula ~ ${formulaPattern}
      or vacancy_amount_formula ~ ${formulaPattern}
      or surplus_shortfall_formula ~ ${formulaPattern}
      or dcr_formula ~ ${formulaPattern}
  `;

  if ((lendersUsingFormula[0]?.count ?? 0) > 0) {
    throw new Error("Remove this input from lender formulas before deleting it.");
  }

  const dependentInputs = await sql`
    select count(*)::int as count
    from rental_lending.variables
    where depends_on_key = ${variableKey}
  `;

  if ((dependentInputs[0]?.count ?? 0) > 0) {
    throw new Error("Remove dependent inputs before deleting this input.");
  }

  await sql`
    delete from rental_lending.variables
    where key = ${variableKey}
  `;
}

async function saveDwellingType(dwellingType: PersistedDwellingType) {
  if (!dwellingType.key?.trim()) {
    throw new Error("Dwelling type key is required.");
  }

  if (!dwellingType.label?.trim()) {
    throw new Error("Dwelling type label is required.");
  }

  await sql`
    insert into rental_lending.dwelling_types (
      key,
      label,
      display_order
    )
    values (
      ${dwellingType.key.trim()},
      ${dwellingType.label.trim()},
      ${dwellingType.displayOrder ?? 0}
    )
    on conflict (key) do update
    set
      label = excluded.label,
      display_order = excluded.display_order
  `;
}

async function deleteDwellingType(dwellingTypeKey: string) {
  const scenariosUsingType = await sql`
    select count(*)::int as count
    from rental_lending.client_scenarios
    where variable_values -> 'clientProfile' ->> 'housingUnitType' = ${dwellingTypeKey}
  `;

  if ((scenariosUsingType[0]?.count ?? 0) > 0) {
    throw new Error("Saved scenarios still use this dwelling type.");
  }

  await sql`
    delete from rental_lending.dwelling_types
    where key = ${dwellingTypeKey}
  `;
}

async function saveScenario(
  payload: {
    clientName: string;
    clientProfile?: Record<string, unknown>;
    lenderId: string | null;
    properties: unknown[];
    summaryValue: number;
    dcr: number;
  }
) {
  if (!payload.clientName?.trim()) {
    throw new Error("Client name is required.");
  }

  await sql`
    insert into rental_lending.client_scenarios (
      lender_id,
      client_name,
      variable_values,
      summary_value,
      dcr,
      calculated_loan_amount
    )
    values (
      ${payload.lenderId},
      ${payload.clientName.trim()},
      ${JSON.stringify({
        clientProfile: {
          ...defaultClientProfile,
          ...(payload.clientProfile ?? {}),
        },
        properties: payload.properties ?? [],
      })}::jsonb,
      ${payload.summaryValue ?? 0},
      ${payload.dcr ?? 0},
      ${payload.summaryValue ?? 0}
    )
  `;
}

const fetchHandler = async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  let body: IncomingRequest;

  try {
    body = (await req.json()) as IncomingRequest;
  } catch {
    return invalid("Request body must be valid JSON.");
  }

  const { action, payload } = body;

  try {
    switch (action) {
      case "bootstrap":
        return jsonResponse(await bootstrap());
      case "save_lender":
        await saveLender(payload?.lender as PersistedLender);
        return jsonResponse({ ok: true });
      case "save_variable":
        await saveVariable(payload?.variable as PersistedVariable);
        return jsonResponse({ ok: true });
      case "delete_variable":
        if (typeof payload?.variableKey !== "string") {
          return invalid("variableKey is required.");
        }
        await deleteVariable(payload.variableKey);
        return jsonResponse({ ok: true });
      case "save_dwelling_type":
        await saveDwellingType(payload?.dwellingType as PersistedDwellingType);
        return jsonResponse({ ok: true });
      case "delete_dwelling_type":
        if (typeof payload?.dwellingTypeKey !== "string") {
          return invalid("dwellingTypeKey is required.");
        }
        await deleteDwellingType(payload.dwellingTypeKey);
        return jsonResponse({ ok: true });
      case "delete_lender":
        if (typeof payload?.lenderId !== "string") {
          return invalid("lenderId is required.");
        }
        await deleteLender(payload.lenderId);
        return jsonResponse({ ok: true });
      case "save_scenario":
        await saveScenario(payload?.scenario as {
          clientName: string;
          clientProfile?: Record<string, unknown>;
          lenderId: string | null;
          properties: unknown[];
          summaryValue: number;
          dcr: number;
        });
        return jsonResponse({ ok: true });
      default:
        return invalid("Unknown action.");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Edge Function error.";
    return invalid(message, 500);
  }
};

const rentalLendingApi = { fetch: fetchHandler };

export default rentalLendingApi;
