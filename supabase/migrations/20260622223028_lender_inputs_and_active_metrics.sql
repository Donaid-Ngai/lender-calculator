alter table rental_lending.lenders
  add column if not exists active_formula_keys jsonb not null default '["surplus_shortfall"]'::jsonb;

insert into rental_lending.variables (
  key,
  label,
  description,
  input_kind,
  default_reference_key,
  display_order
)
values
  ('market_value', 'Market value', 'Current market value of the property.', 'currency', null, 7),
  ('mortgage_balance', 'Mortgage balance', 'Current outstanding mortgage balance for the property.', 'currency', null, 8)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  input_kind = excluded.input_kind,
  default_reference_key = excluded.default_reference_key,
  display_order = excluded.display_order;
