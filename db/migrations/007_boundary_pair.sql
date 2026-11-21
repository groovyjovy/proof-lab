-- 二つの長方形が共有する境界を、同じ外枠の内側で編集する事例研究5b。
create table boundary_pair (
	left_id bigint primary key references feature (id),
	right_id bigint unique not null references feature (id),
	west double precision not null,
	south double precision not null,
	east double precision not null,
	north double precision not null,
	center double precision not null,
	stride double precision not null,
	check (left_id < right_id and south < north and stride > 0
		and west < center - stride and center + stride < east)
);

alter table boundary_pair enable row level security;
create policy boundary_pair_read on boundary_pair for select
	using (exists (select 1 from feature where id = left_id)
		and exists (select 1 from feature where id = right_id));
grant select on boundary_pair to app;
