import { registerRootComponent } from 'expo';
import type { ComponentType } from 'react';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
// Il cast serve solo per le InitialProps di Expo: App ha props tutte opzionali
// (iniettabili nei test) e ignora quelle iniziali della piattaforma.
registerRootComponent(App as ComponentType);
