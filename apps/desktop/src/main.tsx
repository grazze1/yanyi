import React from 'react';
import ReactDOM from 'react-dom/client';
import '@yanyi/design-tokens/tokens.css';
import './styles.css';
import { App } from './App';

const root = document.querySelector('#root');
if (!(root instanceof HTMLElement)) throw new Error('无法初始化研译本地管理端');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
