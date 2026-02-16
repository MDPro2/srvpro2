import { Client } from '../../client';

export class ClientKeyProvider {
  // Keep this switch for future compatibility with srvpro identity policies.
  isLooseIdentityRule = false;

  getClientKey(client: Client): string {
    if (!this.isLooseIdentityRule && client.vpass) {
      return client.name_vpass;
    }
    if (this.isLooseIdentityRule) {
      return client.name || client.ip || 'undefined';
    }
    return `${client.ip}:${client.name}`;
  }
}
