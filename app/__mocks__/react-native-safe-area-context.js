// Automatic react-native-safe-area-context mock for Jest: the package's official
// one (synthetic SafeAreaProvider with zero insets — without it, the
// native provider does not render its children in the test environment).

module.exports = require('react-native-safe-area-context/jest/mock').default;
