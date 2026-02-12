import path from 'path';
import { convertStringArray } from './convert-string-array';

export const loadPaths = (pathStr: string) =>
  convertStringArray(pathStr).map((p) => path.resolve(process.cwd(), p)) || [];
