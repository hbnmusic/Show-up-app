-- Metro settings for the venue-site layer, seeded from src/lib/metros.ts (wave 1 = hot metros). Safe to run twice.
alter table fp.metro_config add column if not exists aliases text[] not null default '{}';

insert into fp.metro_config (metro, name, state, tz, hot, wave, venue_scan_enabled) values
('nyc', 'New York', 'NY', 'America/New_York', true, 1, true),
('la', 'Los Angeles', 'CA', 'America/Los_Angeles', true, 1, true),
('chi', 'Chicago', 'IL', 'America/Chicago', true, 1, true),
('sf', 'San Francisco Bay Area', 'CA', 'America/Los_Angeles', true, 1, true),
('tor', 'Toronto', 'ON', 'America/Toronto', true, 1, true),
('mtl', 'Montréal', 'QC', 'America/Toronto', true, 1, true),
('van', 'Vancouver', 'BC', 'America/Vancouver', true, 1, true),
('bos', 'Boston', 'MA', 'America/New_York', true, 1, true),
('dc', 'Washington', 'DC', 'America/New_York', true, 1, true),
('phl', 'Philadelphia', 'PA', 'America/New_York', true, 1, true),
('atl', 'Atlanta', 'GA', 'America/New_York', false, 3, false),
('mia', 'Miami', 'FL', 'America/New_York', false, 3, false),
('sea', 'Seattle', 'WA', 'America/Los_Angeles', false, 3, false),
('aus', 'Austin', 'TX', 'America/Chicago', false, 3, false),
('nash', 'Nashville', 'TN', 'America/Chicago', false, 3, false),
('den', 'Denver', 'CO', 'America/Denver', false, 3, false),
('dal', 'Dallas–Fort Worth', 'TX', 'America/Chicago', false, 3, false),
('hou', 'Houston', 'TX', 'America/Chicago', false, 3, false),
('phx', 'Phoenix', 'AZ', 'America/Phoenix', false, 3, false),
('sd', 'San Diego', 'CA', 'America/Los_Angeles', false, 3, false),
('por', 'Portland', 'OR', 'America/Los_Angeles', false, 3, false),
('lv', 'Las Vegas', 'NV', 'America/Los_Angeles', false, 3, false),
('msp', 'Minneapolis–St. Paul', 'MN', 'America/Chicago', false, 3, false),
('det', 'Detroit', 'MI', 'America/Detroit', false, 3, false),
('nola', 'New Orleans', 'LA', 'America/Chicago', false, 3, false),
('pit', 'Pittsburgh', 'PA', 'America/New_York', false, 3, false),
('bal', 'Baltimore', 'MD', 'America/New_York', false, 3, false),
('stl', 'St. Louis', 'MO', 'America/Chicago', false, 3, false),
('kc', 'Kansas City', 'MO', 'America/Chicago', false, 3, false),
('orl', 'Orlando', 'FL', 'America/New_York', false, 3, false),
('tpa', 'Tampa', 'FL', 'America/New_York', false, 3, false),
('clt', 'Charlotte', 'NC', 'America/New_York', false, 3, false),
('rdu', 'Raleigh–Durham', 'NC', 'America/New_York', false, 3, false),
('slc', 'Salt Lake City', 'UT', 'America/Denver', false, 3, false),
('cmh', 'Columbus', 'OH', 'America/New_York', false, 3, false),
('cle', 'Cleveland', 'OH', 'America/New_York', false, 3, false),
('cin', 'Cincinnati', 'OH', 'America/New_York', false, 3, false),
('ind', 'Indianapolis', 'IN', 'America/Indiana/Indianapolis', false, 3, false),
('mke', 'Milwaukee', 'WI', 'America/Chicago', false, 3, false),
('sat', 'San Antonio', 'TX', 'America/Chicago', false, 3, false),
('sac', 'Sacramento', 'CA', 'America/Los_Angeles', false, 3, false),
('cgy', 'Calgary', 'AB', 'America/Edmonton', false, 3, false),
('edm', 'Edmonton', 'AB', 'America/Edmonton', false, 3, false),
('ott', 'Ottawa', 'ON', 'America/Toronto', false, 3, false),
('wpg', 'Winnipeg', 'MB', 'America/Winnipeg', false, 3, false),
('yqb', 'Québec City', 'QC', 'America/Toronto', false, 3, false),
('hfx', 'Halifax', 'NS', 'America/Halifax', false, 3, false)
on conflict (metro) do update set name = excluded.name, state = excluded.state, tz = excluded.tz, hot = excluded.hot;

update fp.metro_config set aliases = case metro
  when 'nyc' then array['Brooklyn','Queens','Manhattan','Bronx','Staten Island','NYC','Jersey City','Hoboken']
  when 'sf' then array['San Francisco','Oakland','Berkeley','San Jose']
  when 'mtl' then array['Montreal']
  when 'la' then array['Hollywood','Pasadena','Long Beach','Santa Monica']
  when 'dc' then array['Washington DC','Arlington','Alexandria']
  when 'yqb' then array['Quebec City','Quebec']
  else aliases end
where metro in ('nyc','sf','mtl','la','dc','yqb');
