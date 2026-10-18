import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { WidgetView, hasView } from './widget-views.jsx';
import './options.css';

// One build, many faces: the tabbed settings page, and any single mini app on
// its own when opened as ?view=<id> inside the content script's dock shell.
// An unknown view falls back to the settings page rather than a blank screen -
// a frame left over from an older version should still show something useful.
const view = new URLSearchParams(window.location.search).get('view');

createRoot(document.getElementById('root')).render(
  <StrictMode>{hasView(view) ? <WidgetView id={view} /> : <App />}</StrictMode>,
);
