import { createApp } from 'vue';

import App from './app/App.vue';
import { router } from './app/router';
import './app/styles.css';

createApp(App).use(router).mount('#app');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
  });
}
