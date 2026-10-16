import { registerRootComponent } from 'expo';
import type { ComponentType } from 'react';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
// The cast is only for Expo's InitialProps: App's props are all optional
// (injectable in tests) and it ignores the platform's initial ones.
registerRootComponent(App as ComponentType);
