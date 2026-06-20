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

type IncomingRequest = {
  action?: string;
  payload?: Record<string, unknown>;
};

type PersistedLender = {
  id?: string;
  name: string;
  baseAdjustment: number;
  notes: string;
  rules: Array<{
    variableKey: string;
    impactDirection: string;
    calculationMode: string;
    factor: number;
    referenceVariableKey: string | null;
    notes: string;
  }>;
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

async function bootstrap() {
  const variables = await sql`
    select
      key,
      label,
      coalesce(description, '') as description,
      input_kind as "inputKind",
      default_reference_key as "defaultReferenceKey",
      display_order as "displayOrder"
    from rental_lending.variables
    order by display_order asc
  `;

  const lenders = await sql`
    select
      l.id,
      l.name,
      l.base_adjustment as "baseAdjustment",
      coalesce(l.notes, '') as notes,
      coalesce(
        json_agg(
          json_build_object(
            'variableKey', r.variable_key,
            'impactDirection', r.impact_direction,
            'calculationMode', r.calculation_mode,
            'factor', r.factor,
            'referenceVariableKey', r.reference_variable_key,
            'notes', coalesce(r.notes, '')
          )
          order by v.display_order
        ) filter (where r.id is not null),
        '[]'::json
      ) as rules
    from rental_lending.lenders l
    left join rental_lending.lender_rules r on r.lender_id = l.id
    left join rental_lending.variables v on v.key = r.variable_key
    group by l.id
    order by l.updated_at desc, l.name asc
  `;

  const scenarioRows = await sql`
    select
      s.id,
      s.lender_id as "lenderId",
      l.name as "lenderName",
      s.client_name as "clientName",
      s.base_loan_amount as "baseLoanAmount",
      s.variable_values as "variableValues",
      s.calculated_loan_amount as "calculatedLoanAmount",
      s.updated_at as "updatedAt"
    from rental_lending.client_scenarios s
    left join rental_lending.lenders l on l.id = s.lender_id
    order by s.updated_at desc
    limit 8
  `;

  const scenarios = scenarioRows.map((scenario) => {
    const storedValues = (scenario.variableValues as { properties?: unknown[] }) ?? {};

    return {
      ...scenario,
      properties: Array.isArray(storedValues.properties) ? storedValues.properties : [],
    };
  });

  return { variables, lenders, scenarios };
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
          base_adjustment = ${lender.baseAdjustment ?? 0},
          notes = ${lender.notes ?? ""}
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
          base_adjustment,
          notes
        )
        values (
          ${lender.name.trim()},
          ${lender.baseAdjustment ?? 0},
          ${lender.notes ?? ""}
        )
        returning id
      `;

      lenderId = inserted[0].id as string;
    }

    await tx`
      delete from rental_lending.lender_rules
      where lender_id = ${lenderId}
    `;

    for (const rule of lender.rules) {
      await tx`
        insert into rental_lending.lender_rules (
          lender_id,
          variable_key,
          impact_direction,
          calculation_mode,
          factor,
          reference_variable_key,
          notes
        )
        values (
          ${lenderId},
          ${rule.variableKey},
          ${rule.impactDirection},
          ${rule.calculationMode},
          ${rule.factor ?? 1},
          ${rule.referenceVariableKey},
          ${rule.notes ?? ""}
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

async function saveScenario(
  payload: {
    clientName: string;
    lenderId: string | null;
    baseLoanAmount: number;
    properties: unknown[];
    calculatedLoanAmount: number;
  }
) {
  if (!payload.clientName?.trim()) {
    throw new Error("Client name is required.");
  }

  await sql`
    insert into rental_lending.client_scenarios (
      lender_id,
      client_name,
      base_loan_amount,
      variable_values,
      calculated_loan_amount
    )
    values (
      ${payload.lenderId},
      ${payload.clientName.trim()},
      ${payload.baseLoanAmount ?? 0},
      ${JSON.stringify({ properties: payload.properties ?? [] })}::jsonb,
      ${payload.calculatedLoanAmount ?? 0}
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
      case "delete_lender":
        if (typeof payload?.lenderId !== "string") {
          return invalid("lenderId is required.");
        }
        await deleteLender(payload.lenderId);
        return jsonResponse({ ok: true });
      case "save_scenario":
        await saveScenario(payload?.scenario as {
          clientName: string;
          lenderId: string | null;
          baseLoanAmount: number;
          properties: unknown[];
          calculatedLoanAmount: number;
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
