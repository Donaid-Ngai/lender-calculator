alter table rental_lending.variables
  drop constraint if exists variables_input_kind_check;

alter table rental_lending.variables
  add constraint variables_input_kind_check
  check (input_kind in ('currency', 'percent', 'number', 'boolean'));

alter table rental_lending.variables
  add column if not exists depends_on_key text references rental_lending.variables(key) on delete set null,
  add column if not exists depends_on_value numeric;

create table if not exists rental_lending.dwelling_types (
  key text primary key,
  label text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table rental_lending.lenders
  add column if not exists dwelling_type_percentages jsonb not null default '{}'::jsonb,
  add column if not exists economic_rent_formula text not null default 'economic_rent_amount';

insert into rental_lending.variables (
  key,
  label,
  description,
  input_kind,
  depends_on_key,
  depends_on_value,
  display_order
)
values
  (
    'ownership_percentage',
    '% ownership',
    'Ownership percentage for the subject property.',
    'percent',
    null,
    null,
    9
  ),
  (
    'has_economic_rent',
    'Economic rent?',
    'Choose yes when an economic rent amount should be included.',
    'boolean',
    null,
    null,
    10
  ),
  (
    'economic_rent_amount',
    'Economic rent amount',
    'Amount used when economic rent applies.',
    'currency',
    'has_economic_rent',
    1,
    11
  )
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  input_kind = excluded.input_kind,
  depends_on_key = excluded.depends_on_key,
  depends_on_value = excluded.depends_on_value,
  display_order = excluded.display_order;

insert into rental_lending.dwelling_types (
  key,
  label,
  display_order
)
values
  ('single_family', 'Single family', 1),
  ('semi_detached', 'Semi-detached', 2),
  ('townhouse', 'Townhouse', 3),
  ('condo', 'Condo', 4),
  ('duplex', 'Duplex', 5),
  ('triplex', 'Triplex', 6),
  ('fourplex', 'Fourplex', 7),
  ('multi_unit', 'Multi-unit', 8),
  ('mixed_use', 'Mixed use', 9),
  ('other', 'Other', 10)
on conflict (key) do update
set
  label = excluded.label,
  display_order = excluded.display_order;
