import { CardReader } from 'koishipro-core.js';
import { readCardWithReader } from './read-card-with-reader';

const isAlternative = (code: number, alias: number): boolean =>
  !!alias && Math.floor(alias / 1000) === Math.floor(code / 1000);

export const getOriginalCodeRule = (
  code: number,
  alias: number,
  reader?: CardReader,
): number => {
  if (reader && isAlternative(code, alias)) {
    const aliasData = readCardWithReader(reader, alias);
    if (aliasData) {
      const aliasCode = aliasData.code ?? alias;
      const aliasAlias = aliasData.alias ?? 0;
      return aliasAlias || aliasCode;
    }
  }
  return alias || code;
};
