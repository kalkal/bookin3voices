// Test più stabili su macchine cariche (CI, typecheck in parallelo): i findBy*/waitFor
// aspettano fino a 5 s invece del default di 1 s, e ogni test ha 15 s di margine.
// Le suite girano con l'interfaccia in italiano (vedi src/i18n).
import { configure } from '@testing-library/react-native';

import { setLanguage } from './src/i18n';

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(15000);
setLanguage('it');
