import { mount } from 'svelte';
import '../../styles/theme.css';
import '../../styles/dictate.css';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
    throw new Error('Dictate mount element not found');
}

mount(App, { target });
