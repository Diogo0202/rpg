-- Conta Spotify do usuário (OAuth, Authorization Code com client secret no backend).
--
-- * public.spotify_oauth_states guarda o pedido de autorização em andamento: o hash SHA-256 do
--   state, o usuário que pediu, para onde voltar e a validade (10 minutos). O state em si só existe
--   na URL do Spotify; o banco nunca o vê em claro.
-- * public.spotify_connections guarda uma conexão por usuário: id e nome no Spotify, plano (premium
--   ou free), escopos concedidos e os tokens.
-- * Nenhum cliente lê ou grava as duas tabelas: anon e authenticated não têm privilégio algum e não
--   há policy. Só a API, com a chave de serviço, fala com elas. Os tokens nunca chegam ao navegador.

create table public.spotify_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  return_to text not null check (return_to ~ '^/app(/campaign/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint spotify_oauth_states_short_lived check (expires_at <= created_at + interval '15 minutes')
);
create index spotify_oauth_states_user_idx on public.spotify_oauth_states (user_id, expires_at);

create table public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text not null check (spotify_user_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  product text check (product is null or product ~ '^[a-z_]{1,32}$'),
  scopes text not null check (char_length(scopes) <= 512),
  access_token text not null check (char_length(access_token) between 1 and 2048),
  refresh_token text not null check (char_length(refresh_token) between 1 and 2048),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.spotify_oauth_states enable row level security;
alter table public.spotify_connections enable row level security;

revoke all on public.spotify_oauth_states from public, anon, authenticated;
revoke all on public.spotify_connections from public, anon, authenticated;
grant select, insert, update, delete on public.spotify_oauth_states to service_role;
grant select, insert, update, delete on public.spotify_connections to service_role;
