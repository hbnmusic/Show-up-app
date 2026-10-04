-- Removes the retired seller from the licence layer: its switch rows, its link source, and the purge function branch.
delete from fp.licensed_switches where family <> 'jambase_listings';
delete from fp.licensed_links where source <> 'jambase';

alter table fp.licensed_switches drop constraint licensed_switches_family_check;
alter table fp.licensed_switches add constraint licensed_switches_family_check check (family = 'jambase_listings');

alter table fp.licensed_links drop constraint licensed_links_source_check;
alter table fp.licensed_links add constraint licensed_links_source_check check (source = 'jambase');

create or replace function fp.purge_licensed(src text) returns integer
language plpgsql security definer set search_path to 'fp', 'public' as $$
declare n integer;
begin
  if src <> 'jambase' then raise exception 'source must be jambase'; end if;
  select count(*) into n from fp.licensed_links where source = src;
  perform fp.delete_licensed_links(src);
  update fp.licensed_switches set enabled = false, updated_at = now() where family = 'jambase_listings';
  insert into fp.takedowns (kind, ref, note) values ('purge_licensed', src, null);
  return n;
end $$;
