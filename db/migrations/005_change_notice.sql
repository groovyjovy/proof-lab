-- 地物が変わったことを知らせる(P14)。画面は変更の流れ(/api/events)でこれを受け取る。
-- 更新は、キーに版を書き込んだとき(更新が効いたとき)に知らせる。キーを取っただけ(版 -1)のときや、
-- 効かずに放したキーは知らせない。PostgreSQL の知らせは commit するまで届かないので、取り消された
-- 変更も知らせない。だから、知らせに載るキーは、どれも効いて commit された要求のもの。
-- 作成は、キー(request_key)の付いた地物ができたときに知らせる。
create function notify_feature_change() returns trigger
language plpgsql as $$
begin
	if tg_table_name = 'feature_update' then
		if new.version >= 0 then
			perform pg_notify('feature_changed', json_build_object(
				'id', new.feature_id, 'version', new.version, 'key', new.request_key)::text);
		end if;
	elsif new.request_key is not null then
		perform pg_notify('feature_changed', json_build_object(
			'id', new.id, 'version', new.version, 'key', new.request_key)::text);
	end if;
	return null;
end
$$;

create trigger feature_update_changed after insert or update of version on feature_update
	for each row execute function notify_feature_change();

create trigger feature_created after insert on feature
	for each row execute function notify_feature_change();
