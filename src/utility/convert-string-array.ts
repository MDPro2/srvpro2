export const convertStringArray = (str: string) =>
  str
    ?.split(',')
    .map((s) => s.trim())
    .filter((s) => s) || [];

export const convertNumberArray = (str: string) =>
  str
    ?.split(',')
    .map((s) => parseInt(s.trim()))
    .filter((n) => !isNaN(n)) || [];
