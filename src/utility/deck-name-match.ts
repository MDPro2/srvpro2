const DECK_EXTENSIONS = /(?:\.ydk)+$/i;
const NAME_SEPARATOR = /[+\uFF0B]/;

export function normalizeDeckName(deckName: string) {
  const extensions = deckName.match(DECK_EXTENSIONS)?.[0];
  const extensionCount = extensions?.match(/\.ydk/gi)?.length ?? 0;
  return (
    extensionCount <= 2 ? deckName.replace(DECK_EXTENSIONS, '') : deckName
  ).normalize('NFC');
}

export function deckNameMatch(deckName: string, playerName: string) {
  const normalizedDeckName = normalizeDeckName(deckName);
  const normalizedPlayerName = playerName.normalize('NFC');

  if (normalizedDeckName === normalizedPlayerName) {
    return true;
  }
  if (
    (deckName.match(DECK_EXTENSIONS)?.[0].match(/\.ydk/gi)?.length ?? 0) > 2
  ) {
    return false;
  }

  const parts = normalizedDeckName.split(NAME_SEPARATOR);
  return (
    parts.length === 2 &&
    parts[0].length > 0 &&
    parts[1].length > 0 &&
    (normalizedPlayerName === parts[0] || normalizedPlayerName === parts[1])
  );
}
