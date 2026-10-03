/** robots.txt parsing (RFC 9309 rules: longest match wins, Allow wins a tie, `*` and `$` wildcards). */

export type RobotsRules = { allow: string[]; disallow: string[]; crawlDelaySec?: number };

export function parseRobots(txt: string, userAgent: string): RobotsRules {
  const token = userAgent.split(/[\/\s]/)[0].toLowerCase();
  type Group = { agents: string[]; allow: string[]; disallow: string[]; delay?: number };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow') cur.allow.push(val);
    else if (key === 'disallow') cur.disallow.push(val);
    else if (key === 'crawl-delay') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const pool = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    allow: pool.flatMap((g) => g.allow),
    disallow: pool.flatMap((g) => g.disallow),
    crawlDelaySec: pool.map((g) => g.delay).find((d) => d != null),
  };
}

function matchLen(pattern: string, path: string): number {
  if (!pattern) return -1; // an empty Disallow allows everything
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path) ? body.replace(/\*/g, '').length : -1;
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const d of rules.disallow) {
    const l = matchLen(d, path);
    if (l > best) { best = l; allowed = false; }
  }
  for (const a of rules.allow) {
    const l = matchLen(a, path);
    if (l >= best && l >= 0) { best = l; allowed = true; }
  }
  return allowed;
}

/** What we do with a robots.txt fetch result: a missing file (404) allows crawling; a 401/403 or server error does not. */
export function robotsFromStatus(status: number): 'allow_all' | 'deny_all' | 'parse' {
  if (status >= 200 && status < 300) return 'parse';
  if (status === 404 || status === 410) return 'allow_all';
  return 'deny_all';
}
