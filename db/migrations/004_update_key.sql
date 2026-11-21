-- 更新の冪等キー(P12)。同じキーの更新は1回しか効かない。効かせたときの版を残し、同じキーが来たら成功だけを返す。
create table feature_update (
	request_key uuid primary key,
	feature_id bigint not null references feature (id),
	version integer not null
);

-- キーは、読める地物のものだけ見え、書き込める地物にだけ記録できる(feature の RLS がそのまま効く)
alter table feature_update enable row level security;
create policy feature_update_read on feature_update for select
	using (exists (select 1 from feature f where f.id = feature_id));
create policy feature_update_write on feature_update for insert
	with check (exists (select 1 from feature f where f.id = feature_id and app_can_write(f.city, f.public)));
create policy feature_update_settle on feature_update for update
	using (exists (select 1 from feature f where f.id = feature_id and app_can_write(f.city, f.public)));
create policy feature_update_release on feature_update for delete
	using (exists (select 1 from feature f where f.id = feature_id and app_can_write(f.city, f.public)));

grant select, insert, update, delete on feature_update to app;
