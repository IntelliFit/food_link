create extension if not exists pgcrypto;

create table if not exists public.test_backend_datasets (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text default ''::text,
    source_type text not null default 'local_import',
    source_ref text default ''::text,
    cover_image_url text,
    item_count integer not null default 0,
    labeled_count integer not null default 0,
    unlabeled_count integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.test_backend_dataset_items (
    id uuid primary key default gen_random_uuid(),
    dataset_id uuid not null references public.test_backend_datasets(id) on delete cascade,
    filename text not null,
    image_url text not null,
    label_mode text not null default 'total',
    true_weight numeric(10, 2) not null default 0,
    expected_items jsonb not null default '[]'::jsonb,
    sort_order integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_test_backend_datasets_created_at
    on public.test_backend_datasets(created_at desc);

create index if not exists idx_test_backend_dataset_items_dataset_id
    on public.test_backend_dataset_items(dataset_id, sort_order);

create unique index if not exists uq_test_backend_dataset_items_dataset_filename
    on public.test_backend_dataset_items(dataset_id, filename);
