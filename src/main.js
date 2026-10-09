import { mount } from 'svelte';
import App from './App.svelte';
import { registerServiceWorker } from './lib/pwa.js';
import './app.css';
import './library.css';
import './reader.css';
import './docx.css';

mount(App, { target: document.getElementById('app') });
registerServiceWorker();
