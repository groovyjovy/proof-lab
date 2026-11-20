-- 保存の冪等キー(P10)。同じキーの作成は1つの地物にしかならない。
alter table feature add column request_key uuid unique;
