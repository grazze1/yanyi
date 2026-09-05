import { browser } from 'wxt/browser';

interface StatusResponse {
  snapshot?: { connection?: string; message?: string };
  handshake?: {
    payload?: {
      hostVersion?: string;
      databaseSchemaVersion?: number;
      negotiatedProtocolVersion?: number;
    };
  };
}

function setText(id: string, value: string) {
  const element = document.querySelector(`#${id}`);
  if (element !== null) element.textContent = value;
}

async function refreshStatus() {
  setText('connection-value', '检测中…');
  const response: unknown = await browser.runtime
    .sendMessage({ type: 'yanyi.status.get' })
    .catch(() => undefined);
  if (typeof response !== 'object' || response === null) {
    setText('connection-value', '未连接');
    setText('status-message', '扩展后台没有响应，请重新加载扩展。');
    return;
  }
  const status = response as StatusResponse;
  const connection = status.snapshot?.connection ?? 'disconnected';
  setText('connection-value', connection === 'connected' ? '已连接' : '未连接');
  setText('host-version', status.handshake?.payload?.hostVersion ?? '—');
  setText(
    'schema-version',
    status.handshake?.payload?.databaseSchemaVersion === undefined
      ? '—'
      : String(status.handshake.payload.databaseSchemaVersion),
  );
  setText(
    'protocol-version',
    status.handshake?.payload?.negotiatedProtocolVersion === undefined
      ? '—'
      : String(status.handshake.payload.negotiatedProtocolVersion),
  );
  setText(
    'status-message',
    connection === 'connected'
      ? '本地服务握手正常。'
      : (status.snapshot?.message ?? '请启动桌面端并检查 Native Host 注册。'),
  );
}

document.querySelector('#refresh-status')?.addEventListener('click', () => void refreshStatus());
document.querySelector('#revoke-origins')?.addEventListener('click', () => {
  void browser.permissions
    .remove({ origins: ['http://*/*', 'https://*/*'] })
    .then((removed) =>
      setText(
        'status-message',
        removed ? '已撤销 URL PDF 来源权限。' : '当前没有已授予的 URL PDF 来源权限。',
      ),
    );
});
document.querySelector('#open-pdf-reader')?.addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/pdf-reader.html') });
});

void refreshStatus();
