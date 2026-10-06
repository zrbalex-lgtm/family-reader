export function normalizeSearch(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
}

export function filterAndSortBooks(books, kind, query, sort) {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const selected = books.filter((book) => book.kind === kind && terms.every((term) =>
    normalizeSearch([book.title, book.author, book.series].filter(Boolean).join(' ')).includes(term),
  ));
  const collator = new Intl.Collator(['en', 'ru'], { sensitivity: 'base', numeric: true });
  const title = (a, b) => collator.compare(normalizeSearch(a.title), normalizeSearch(b.title)) || a.id.localeCompare(b.id);
  return selected.sort((a, b) => {
    if (sort === 'title') return title(a, b);
    if (sort === 'author') {
      if (!!a.author !== !!b.author) return a.author ? -1 : 1;
      return collator.compare(normalizeSearch(a.author), normalizeSearch(b.author)) || title(a, b);
    }
    return Date.parse(b.created_at) - Date.parse(a.created_at) || title(a, b);
  });
}
