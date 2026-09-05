import { defineConfig } from 'wxt';

const developmentPublicKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvxguqJpkmnUKfSCzJU707w5gIu1AyckW8jfKRMD3qN4u6UdCN0MYk1QExZ6KVmeX19RgMweWlemygIouKXGNRcw2yBJbNEnRomjLYEFk2oZGXzJjNRqqi1L3vEEj3F9CvtaTA+uRExqfFzcVvdr3GvvV5PlisM40VO9tEfYKiAQVc5MbNjceiNthTVQCBkNFySvc6WOwFI+/2MYQRQP+uiBzT1ptEUBsR7rYJ54zlgY9vFHxzTFyhhhclLxlAPan7ioZVrKrMRTE71AMOt4tyXOh+kaT/yE/s4hViHobe3AVAE/r25mBIXWzEc2I4f7p6Tb3hE1yMFb7NMflHqcmnQIDAQAB';
const chromeDevelopmentPublicKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkBbrm2toUWVCdk/8eI51TkptVwZ4qEQnkk/ysrzGD2bdKiYbKIpqoDi3gmQeNkirNMzmqP4WSB0I9juMyZ/Z5jxn+3r1XFyuZWX34w0KCiCZoIzd14Al91GuY/gon//tFSezjgo8Kn4WuKkPbE0E5VifrJQArtzCmg+Fiv4gHLwaUqk/urUeAXG8R+Dc4NhK/waelTThSPtbGUrl11aTpo6911q2SPvCG6w/9yHpDeI38x45/r+BoPmRKOjjL8529fMnhNir1uRFRCIV+BQLnJYfIva4kIEfCujsgqqvqbPqhCGjJOMko3Y4U8lLK/RcHZ2mwo0wRCOuWc9/Ivm3BwIDAQAB';

const testHostPermissions = [
  'http://127.0.0.1/*',
  'https://github.com/*',
  'https://pytorch.org/*',
  'https://docs.pytorch.org/*',
];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser, mode }) => ({
    name: '研译',
    description: '面向技术文档与论文的上下文感知翻译系统',
    version: '0.1.0',
    key: browser === 'chrome' ? chromeDevelopmentPublicKey : developmentPublicKey,
    permissions: [
      'activeTab',
      'contextMenus',
      'nativeMessaging',
      'scripting',
      'sidePanel',
      'storage',
    ],
    ...(mode === 'test' ? { host_permissions: testHostPermissions } : {}),
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      'translate-page': { description: '翻译当前页面' },
      'open-sidepanel': { description: '打开研译侧边栏' },
    },
    side_panel: { default_path: 'sidepanel.html' },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
    },
  }),
});
