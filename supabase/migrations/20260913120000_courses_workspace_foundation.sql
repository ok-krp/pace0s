-- PaceOS scalable workspace + grocery foundation.
-- Additive only: existing user_state data remains untouched while new domain data
-- can migrate incrementally toward a relational multi-tenant model.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.grocery_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Courses de la semaine',
  week_start date,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.grocery_list_items (
  id uuid primary key default gen_random_uuid(),
  grocery_list_id uuid not null references public.grocery_lists(id) on delete cascade,
  name text not null,
  quantity text,
  category text not null default 'Autre',
  checked boolean not null default false,
  note text,
  source text not null default 'manual' check (source in ('manual', 'meal_plan', 'recipe', 'ai')),
  source_ref text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  quantity text,
  unit text,
  expires_at date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists grocery_lists_workspace_week_idx on public.grocery_lists(workspace_id, week_start);
create index if not exists grocery_items_list_checked_idx on public.grocery_list_items(grocery_list_id, checked);
create index if not exists pantry_items_workspace_expiry_idx on public.pantry_items(workspace_id, expires_at);

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;
alter table public.grocery_lists enable row level security;
alter table public.grocery_lists force row level security;
alter table public.grocery_list_items enable row level security;
alter table public.grocery_list_items force row level security;
alter table public.pantry_items enable row level security;
alter table public.pantry_items force row level security;

create policy "workspace members can read workspaces"
  on public.workspaces for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()
  ) or owner_user_id = auth.uid());

create policy "owners can create workspaces"
  on public.workspaces for insert
  with check (owner_user_id = auth.uid());

create policy "workspace admins can update workspaces"
  on public.workspaces for update
  using (owner_user_id = auth.uid() or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = auth.uid() and wm.role = 'admin'
  ))
  with check (owner_user_id = auth.uid() or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspaces.id and wm.user_id = auth.uid() and wm.role = 'admin'
  ));

create policy "members can read membership"
  on public.workspace_members for select
  using (user_id = auth.uid() or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin')
  ));

create policy "workspace admins manage membership"
  on public.workspace_members for all
  using (exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id and wm.user_id = auth.uid() and wm.role = 'admin'
  ))
  with check (exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id and wm.user_id = auth.uid() and wm.role = 'admin'
  ));

create policy "members manage grocery lists"
  on public.grocery_lists for all
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = grocery_lists.workspace_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.workspaces w
    where w.id = grocery_lists.workspace_id and w.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = grocery_lists.workspace_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.workspaces w
    where w.id = grocery_lists.workspace_id and w.owner_user_id = auth.uid()
  ));

create policy "members manage grocery items"
  on public.grocery_list_items for all
  using (exists (
    select 1 from public.grocery_lists gl
    join public.workspace_members wm on wm.workspace_id = gl.workspace_id
    where gl.id = grocery_list_items.grocery_list_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.grocery_lists gl
    join public.workspaces w on w.id = gl.workspace_id
    where gl.id = grocery_list_items.grocery_list_id and w.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.grocery_lists gl
    join public.workspace_members wm on wm.workspace_id = gl.workspace_id
    where gl.id = grocery_list_items.grocery_list_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.grocery_lists gl
    join public.workspaces w on w.id = gl.workspace_id
    where gl.id = grocery_list_items.grocery_list_id and w.owner_user_id = auth.uid()
  ));

create policy "members manage pantry"
  on public.pantry_items for all
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = pantry_items.workspace_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.workspaces w
    where w.id = pantry_items.workspace_id and w.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = pantry_items.workspace_id and wm.user_id = auth.uid()
  ) or exists (
    select 1 from public.workspaces w
    where w.id = pantry_items.workspace_id and w.owner_user_id = auth.uid()
  ));

comment on table public.workspaces is 'Multi-tenant boundary for personal, family and future coach/business use.';
comment on table public.grocery_lists is 'Relational weekly shopping lists; replaces generic user_state for scalable grocery workflows.';
comment on table public.grocery_list_items is 'Shopping items with provenance for meal-plan, recipe and AI automation.';
comment on table public.pantry_items is 'Inventory used to deduct already-owned ingredients from generated shopping lists.';
