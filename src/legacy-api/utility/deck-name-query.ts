const DELIMITER_CLASS = '[+\uFF0B]';
const NO_DELIMITER_CLASS = '[^+\uFF0B]';

function escapeRegex(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function getDeckNameExactCandidates(playerName: string) {
  return normalizedForms(playerName).flatMap((value) => [
    value,
    `${value}.ydk`,
    `${value}.ydk.ydk`,
  ]);
}

export function getDeckNameRegexCandidates(playerName: string) {
  return normalizedForms(playerName).flatMap((value) => {
    const escapedPlayerName = escapeRegex(value);
    return [
      `^${escapedPlayerName}${DELIMITER_CLASS}${NO_DELIMITER_CLASS}+(\\.ydk){0,2}$`,
      `^${NO_DELIMITER_CLASS}+${DELIMITER_CLASS}${escapedPlayerName}(\\.ydk){0,2}$`,
    ];
  });
}

function normalizedForms(value: string) {
  return Array.from(new Set([value.normalize('NFC'), value.normalize('NFD')]));
}
