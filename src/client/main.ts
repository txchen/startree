import { createVaporApp } from 'vue';

import App from './app/App.vue';
import './app/styles.css';

createVaporApp(App).mount('#app');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
  });
}
