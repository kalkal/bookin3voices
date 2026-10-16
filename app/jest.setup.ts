// More stable tests on loaded machines (CI, parallel typecheck): findBy*/waitFor
// wait up to 5 s instead of the default 1 s, and each test has 15 s of margin.
// The suites run with the UI in Italian (see src/i18n).
import { configure } from '@testing-library/react-native';

import { setLanguage } from './src/i18n';

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(15000);
setLanguage('it');
