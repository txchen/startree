import { createApp } from 'vue';

import App from './app/App.vue';
import './app/styles.css';

createApp(App).mount('#app');

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
  });
}
