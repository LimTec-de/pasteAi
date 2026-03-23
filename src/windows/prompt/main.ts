import { mount } from 'svelte';
import '../../styles/theme.css';
import '../../styles/prompt.css';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
    throw new Error('Prompt mount element not found');
}

mount(App, { target });
