export const normalizeSearch = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase()
export const queryTokens = (query: string) =>
  normalizeSearch(query).trim().split(/\s+/).filter(Boolean)
