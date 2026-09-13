import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n/I18nContext';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('缺少 #root 容器');

// Provider 挂在路由**之上**：切页不会重建它，因此语言选择跨路由保持。
createRoot(el).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
