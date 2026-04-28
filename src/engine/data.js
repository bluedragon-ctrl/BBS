// JSON content loader. Fetches all category files in parallel,
// validates IDs unique, returns a lookup API.

const FILES = ['spells', 'monsters', 'items', 'statuses', 'nodes', 'events'];

export async function loadData() {
  const cacheBust = Date.now();
  const fetched = await Promise.all(
    FILES.map(name =>
      fetch(`data/${name}.json?_=${cacheBust}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    )
  );

  const tables = {};
  FILES.forEach((name, i) => {
    const arr = Array.isArray(fetched[i]) ? fetched[i] : [];
    const map = new Map();
    for (const entry of arr) {
      if (!entry || !entry.id) {
        console.warn(`${name}.json: entry missing id`, entry);
        continue;
      }
      if (map.has(entry.id)) {
        throw new Error(`Duplicate id "${entry.id}" in ${name}.json`);
      }
      map.set(entry.id, entry);
    }
    tables[name] = map;
  });

  return {
    spell:   id => tables.spells.get(id),
    monster: id => tables.monsters.get(id),
    item:    id => tables.items.get(id),
    status:  id => tables.statuses.get(id),
    node:    id => tables.nodes.get(id),
    event:   id => tables.events.get(id),
    list:    name => Array.from(tables[name]?.values() ?? []),
    has:     (name, id) => tables[name]?.has(id) ?? false,
    _tables: tables,
  };
}
