// Automatic AsyncStorage mock for Jest: the package's official one
// (in memory). The native module does not exist in the test environment.

module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
