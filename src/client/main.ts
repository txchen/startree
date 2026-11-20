import { createApp } from 'vue';

import App from './app/App.vue';
import './app/theme.css';
import './app/styles.css';

createApp(App).mount('#app');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js');
  });
}
