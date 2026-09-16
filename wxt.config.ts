import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Web Reader',
    description: 'A web reader that makes long articles easier and more enjoyable to read.”',
    permissions: ['activeTab', 'storage', 'scripting', 'contextMenus', 'clipboardWrite'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    web_accessible_resources: [
      {
        resources: ['icons/*'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
    commands: {
      'activate-reading': {
        suggested_key: {
          default: 'Alt+Shift+L',
          mac: 'Command+Shift+L',
        },
        description: 'Enable Web Reader on the current page',
      },
    },
    icons: {
      16: '/icons/just-read-it-16.png',
      32: '/icons/just-read-it-32.png',
      48: '/icons/just-read-it-48.png',
      96: '/icons/just-read-it-96.png',
      128: '/icons/just-read-it-128.png',
    },
    action: {
      default_icon: {
        16: '/icons/just-read-it-16.png',
        32: '/icons/just-read-it-32.png',
      },
    },
    options_ui: {
      page: '/home.html',
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: 'just-read-it@local',
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser !== 'firefox' && manifest.permissions && !manifest.permissions.includes('tts')) {
        manifest.permissions.push('tts');
      }
    },
  },
});
