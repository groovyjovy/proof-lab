-- 権限の変更を commit したら、本人の変更の流れに知らせる(P15)。
-- 通知には ID だけを載せ、サーバーが送る時点の権限を DB から読み直す。
create function notify_user_permission() returns trigger
language plpgsql as $$
begin
	perform pg_notify('user_changed', json_build_object('id', new.id)::text);
	return null;
end
$$;

create trigger user_permission_changed after update of role, "canEdit" on "user"
	for each row
	when (old.role is distinct from new.role or old."canEdit" is distinct from new."canEdit")
	execute function notify_user_permission();
