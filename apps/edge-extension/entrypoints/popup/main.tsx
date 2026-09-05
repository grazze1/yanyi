import React from 'react';
import ReactDOM from 'react-dom/client';
import '@yanyi/design-tokens/tokens.css';
import './popup.css';
import { PopupApp } from './PopupApp';
import { createBrowserPopupAdapter, type PopupAdapter } from './popupAdapter';

const root = document.querySelector('#root');
if (!(root instanceof HTMLElement)) throw new Error('无法初始化扩展弹窗');

async function resolvePopupAdapter(): Promise<PopupAdapter> {
  const fixture = new URLSearchParams(location.search).get('fixture');
  if ((import.meta.env.DEV || import.meta.env.MODE === 'test') && fixture !== null) {
    const { createFixturePopupAdapter } = await import('./popupFixtureAdapter');
    return createFixturePopupAdapter(fixture);
  }
  return createBrowserPopupAdapter();
}

void resolvePopupAdapter().then((adapter) => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <PopupApp adapter={adapter} />
    </React.StrictMode>,
  );
});
