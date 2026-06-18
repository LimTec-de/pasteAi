import { mount } from 'svelte';
import '../../styles/theme.css';
import '../../styles/answer.css';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
    throw new Error('Answer mount element not found');
}

mount(App, { target });
