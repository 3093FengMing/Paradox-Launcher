export async function checkRender(context) {
  const {
    assert,
    resolve,
    loadApp,
    uiRoot,
    React,
    renderToStaticMarkup,
    I18nextProvider,
    originalAccounts,
    prompt,
  } = context;
  {
    const app = loadApp(
      new Map([
        [resolve(uiRoot, 'src/components/account-avatar.css'), {}],
        [resolve(uiRoot, 'src/api.ts'), { desktop: true }],
      ]),
    );
    const i18n = app('i18n.ts').default;
    const AccountsPage = app('pages/AccountsPage.tsx').default;
    const AppSidebar = app('components/AppSidebar.tsx').default;
    const contexts = app('launcher/public/context.ts');
    const account = {
      id: 'online-account',
      name: 'OnlinePlayer',
      skin_url: 'https://textures.minecraft.net/texture/private',
    };
    const actions = {
      select: async () => true,
      logout: async () => true,
      reload: async () => true,
      configure: async () => true,
      login: async () => true,
      refresh: async () => true,
      cancelLogin: async () => {},
      openLoginPage: async () => {},
      copyLoginCode: async () => {},
      patchClientId() {},
      beginLogout() {},
      cancelLogout() {},
      confirmLogout: async () => true,
    };
    const props = {
      username: 'OfflinePlayer',
      draftUsername: 'OfflinePlayer',
      busy: false,
      saving: false,
      onUsernameChange: () => {},
      onSave: () => {},
      onError: () => {},
    };
    function render(Component, values) {
      const accounts = values.accounts ?? { state: { accounts: [account] } };
      const snapshot = {
        accounts: {
          clientIdDraft: accounts.state.client_id ?? '',
          removingId: null,
          promptActionPending: null,
          promptExpired: !!accounts.prompt && accounts.prompt.expires_at <= Date.now() / 1000,
          ...accounts,
        },
        config: { value: { settings: { offline_username: 'OfflinePlayer' } } },
        settings: { draft: { offline_username: 'OfflinePlayer' }, saving: false },
        activity: null,
        downloads: { active: false, pending: [] },
        window: { desktop: true },
        avatars: {},
      };
      return renderToStaticMarkup(
        React.createElement(
          I18nextProvider,
          { i18n },
          React.createElement(
            contexts.LauncherActionsContext.Provider,
            { value: { accounts: actions, settings: { patch() {} } } },
            React.createElement(
              contexts.LauncherSnapshotContext.Provider,
              { value: snapshot },
              React.createElement(Component, values),
            ),
          ),
        ),
      );
    }
    for (const language of ['en-US', 'zh-CN']) {
      await i18n.changeLanguage(language);
      const state = { ...originalAccounts, active: account.id, accounts: [account] };
      const beginMarkup = render(AccountsPage, {
        ...props,
        accounts: {
          ...actions,
          state,
          recovery: [],
          ready: true,
          loading: false,
          loadError: null,
          pending: true,
          loginPending: true,
          cancelling: false,
          prompt: null,
        },
      });
      const beginButtons = [...beginMarkup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
      assert.ok(
        beginButtons.some(
          (match) => !match[1].includes('disabled') && match[2].includes(i18n.t('common.cancel')),
        ),
        'a held device-code request must show a working cancel control',
      );
      const markup = render(AccountsPage, {
        ...props,
        accounts: {
          ...actions,
          state,
          recovery: [],
          ready: true,
          loading: false,
          loadError: null,
          pending: true,
          cancelling: true,
          prompt,
        },
      });
      const buttons = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
      assert.ok(
        buttons.some(
          (match) => match[1].includes('disabled') && match[2].includes(i18n.t('auth.cancelling')),
        ),
      );
      assert.ok(
        buttons.some(
          (match) => match[1].includes('disabled') && match[2].includes(i18n.t('auth.copyCode')),
        ),
      );
      assert.ok(!markup.includes(account.skin_url), 'render only locally cached avatar data');
      const expiredMarkup = render(AccountsPage, {
        ...props,
        accounts: {
          ...actions,
          state,
          recovery: [],
          ready: true,
          loading: false,
          loadError: null,
          pending: true,
          cancelling: false,
          prompt: { ...prompt, expires_at: 1 },
        },
      });
      assert.ok(expiredMarkup.includes(i18n.t('auth.codeExpired')));
      const sidebar = render(AppSidebar, {
        routes: app('lib/navigation.ts').builtinRoutes,
        config: { settings: { offline_username: 'OfflinePlayer' }, profiles: [] },
        account,
        page: 'home',
        immersive: true,
        desktop: true,
        hasErrors: false,
        onNavigate: () => {},
      });
      assert.ok(sidebar.includes('OnlinePlayer'));
      assert.ok(sidebar.includes(i18n.t('auth.microsoftIdentity')));
      assert.ok(!sidebar.includes('OfflinePlayer'));
    }
  }
}
