import { createAppContext } from 'nfkit';
import { ContextState } from './app';

export const PluginLoader = () => {
  const ctx = createAppContext<ContextState>();

  return ctx;
};
