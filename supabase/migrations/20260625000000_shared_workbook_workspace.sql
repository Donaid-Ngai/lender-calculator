create table if not exists public.workbook_workspace (
  id text primary key default 'shared',
  templates jsonb not null default '[]'::jsonb,
  clients jsonb not null default '[]'::jsonb,
  run_results jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint workbook_workspace_shared_id check (id = 'shared'),
  constraint workbook_workspace_templates_array check (jsonb_typeof(templates) = 'array'),
  constraint workbook_workspace_clients_array check (jsonb_typeof(clients) = 'array'),
  constraint workbook_workspace_run_results_array check (jsonb_typeof(run_results) = 'array')
);

drop trigger if exists workbook_workspace_set_updated_at on public.workbook_workspace;
create trigger workbook_workspace_set_updated_at
before update on public.workbook_workspace
for each row execute procedure rental_lending.set_updated_at();

alter table public.workbook_workspace enable row level security;

insert into public.workbook_workspace (id)
values ('shared')
on conflict (id) do nothing;
