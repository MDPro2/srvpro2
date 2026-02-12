import { Aragami } from 'aragami';
import { AppContext } from 'nfkit';

export class AragamiService {
  constructor(private ctx: AppContext) {}

  aragami = new Aragami();
}
