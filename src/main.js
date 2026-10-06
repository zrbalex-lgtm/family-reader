import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import './library.css';
import './reader.css';

mount(App, { target: document.getElementById('app') });
