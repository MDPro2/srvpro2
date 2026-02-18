import { AppContext } from 'nfkit';
import { FileResourceService } from '../file-resource';
import { Logger } from './logger';

type PermissionSet = Record<string, boolean>;

type UserPermissions = string | PermissionSet;

type UserEntry = {
  password: string;
  enabled: boolean;
  permissions: UserPermissions;
  [key: string]: unknown;
};

type UsersFile = {
  file?: string;
  permission_examples: Record<string, PermissionSet>;
  users: Record<string, UserEntry>;
};

const EMPTY_USERS_FILE: UsersFile = {
  permission_examples: {},
  users: {},
};

export class LegacyApiAuthService {
  private logger = this.ctx
    .get(() => Logger)
    .createLogger('LegacyApiAuthService');
  private fileResource = this.ctx.get(() => FileResourceService);

  constructor(private ctx: AppContext) {}

  async auth(
    name: string,
    pass: string,
    permissionRequired: string,
    action = 'unknown',
  ) {
    const usersData = await this.fileResource.getDataOrEmptyAsync(
      'users',
      EMPTY_USERS_FILE,
      {
        forceRead: true,
      },
    );

    const user = usersData.users[name];
    if (!user) {
      this.logger.info(
        {
          user: name,
          permissionRequired,
          action,
          result: 'unknown_user',
        },
        'Legacy API auth',
      );
      return false;
    }

    if (user.password !== pass) {
      this.logger.info(
        {
          user: name,
          permissionRequired,
          action,
          result: 'bad_password',
        },
        'Legacy API auth',
      );
      return false;
    }

    if (!user.enabled) {
      this.logger.info(
        {
          user: name,
          permissionRequired,
          action,
          result: 'disabled_user',
        },
        'Legacy API auth',
      );
      return false;
    }

    const permission = this.resolvePermissionSet(usersData, user.permissions);
    const allowed = !!permission?.[permissionRequired];
    this.logger.info(
      {
        user: name,
        permissionRequired,
        action,
        result: allowed ? 'ok' : 'permission_denied',
      },
      'Legacy API auth',
    );
    return allowed;
  }

  private resolvePermissionSet(
    usersData: UsersFile,
    permissions: UserPermissions,
  ): PermissionSet | undefined {
    if (typeof permissions === 'string') {
      return usersData.permission_examples[permissions];
    }
    if (permissions && typeof permissions === 'object') {
      return permissions;
    }
    return undefined;
  }
}
