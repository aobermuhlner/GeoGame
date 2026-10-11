import { render } from 'preact';
// First, so `isApp` reads the launch URL before anything rewrites it.
import './platform';
import { App } from './app';
import { registerServiceWorker } from './pwa';
import './styles.css';

render(<App />, document.getElementById('app')!);
registerServiceWorker();
