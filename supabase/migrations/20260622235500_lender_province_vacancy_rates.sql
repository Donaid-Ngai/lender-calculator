alter table rental_lending.lenders
  add column if not exists province_vacancy_rates jsonb not null default '{}'::jsonb;
