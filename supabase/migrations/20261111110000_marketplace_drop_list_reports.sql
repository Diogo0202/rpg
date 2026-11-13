-- marketplace_list_reports devolvia reporter_id (quem denunciou) e nenhum código a usa.
-- A fila de moderação oficial é marketplace_moderation_queue, que não identifica o denunciante.
drop function if exists public.marketplace_list_reports(integer, integer);
