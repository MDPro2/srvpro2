import { AppContext } from 'nfkit';
import { Config, loadConfig } from '../config';

export class ConfigService {
  constructor(private app: AppContext) {}
  config = loadConfig();

  getConfig<K extends keyof Config, D extends Config[K]>(
    key: K,
    defaultValue?: D,
  ): D extends string ? Config[K] | D : Config[K] | undefined {
    return (this.config[key] || (defaultValue ?? undefined)) as any;
  }
}
