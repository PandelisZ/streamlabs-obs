import Vue from 'vue';
import URI from 'urijs';
import { defer } from 'lodash';
import { PersistentStatefulService } from './persistent-stateful-service';
import { Inject } from './service';
import { mutation } from './stateful-service';
import electron from '../vendor/electron';
import { HostsService } from './hosts';
import { getPlatformService, IPlatformAuth, TPlatform } from './platforms';

// Eventually we will support authing multiple platforms at once
interface IUserServiceState {
  auth?: IPlatformAuth;
}


export class UserService extends PersistentStatefulService<IUserServiceState> {

  @Inject()
  hostsService: HostsService;

  @mutation
  LOGIN(auth: IPlatformAuth) {
    Vue.set(this.state, 'auth', auth);
  }


  @mutation
  LOGOUT() {
    Vue.delete(this.state, 'auth');
  }


  init() {
    super.init();

    this.validateLogin();
  }


  // Makes sure the user's login is still good
  validateLogin() {
    if (!this.isLoggedIn()) return;

    const host = this.hostsService.streamlabs;
    const token = this.widgetToken;
    const url = `https://${host}/api/v5/slobs/validate/${token}`;
    const request = new Request(url);

    fetch(request).then(res => {
      return res.text();
    }).then(valid => {
      if (valid.match(/false/)) this.LOGOUT();
    });
  }


  isLoggedIn() {
    return !!(this.state.auth && this.state.auth.widgetToken);
  }


  get widgetToken() {
    if (this.isLoggedIn()) {
      return this.state.auth.widgetToken;
    }
  }


  get platform() {
    if (this.isLoggedIn()) {
      return this.state.auth.platform;
    }
  }


  get username() {
    if (this.isLoggedIn()) {
      return this.state.auth.platform.username;
    }
  }


  logOut() {
    this.LOGOUT();
  }


  // Starts the authentication process.  Multiple callbacks
  // can be passed for various events.
  startAuth(platform: TPlatform, onWindowShow: Function, onAuthFinish: Function) {
    const service = getPlatformService(platform);

    const authWindow = new electron.remote.BrowserWindow({
      ...service.authWindowOptions,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: false
      }
    });

    authWindow.webContents.on('did-navigate', (e, url) => {
      const parsed = this.parseAuthFromUrl(url);

      if (parsed) {
        authWindow.close();
        this.LOGIN(parsed);
        service.setupStreamSettings(parsed);
        defer(onAuthFinish);
      }
    });

    authWindow.once('ready-to-show', () => {
      authWindow.show();
      defer(onWindowShow);
    });

    authWindow.setMenu(null);
    authWindow.loadURL(service.authUrl);
  }


  // Parses tokens out of the auth URL
  private parseAuthFromUrl(url: string) {
    const query = URI.parseQuery(URI.parse(url).query);

    if (query.token && query.platform_username && query.platform_token && query.platform_id) {
      return {
        widgetToken: query.token,
        platform: {
          type: query.platform,
          username: query.platform_username,
          token: query.platform_token,
          id: query.platform_id
        }
      } as IPlatformAuth;
    }

    return false;
  }

}

// You can use this decorator to ensure the user is logged in
// before proceeding
export function requiresLogin() {
  return (target: any, methodName: string, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;

    return {
      ...descriptor,
      value(...args: any[]) {
        // TODO: Redirect to login if not logged in?
        if (UserService.instance.isLoggedIn()) return original.apply(target, args);
      }
    };
  };
}