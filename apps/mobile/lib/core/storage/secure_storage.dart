import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'storage_keys.dart';

class SecureStorageService {
  const SecureStorageService(this._storage);

  final FlutterSecureStorage _storage;

  // Cortex API key
  Future<String?> getCortexApiKey() =>
      _storage.read(key: StorageKeys.cortexApiKey);
  Future<void> setCortexApiKey(String key) =>
      _storage.write(key: StorageKeys.cortexApiKey, value: key);
  Future<void> deleteCortexApiKey() =>
      _storage.delete(key: StorageKeys.cortexApiKey);

  // Wallet address
  Future<String?> getWalletAddress() =>
      _storage.read(key: StorageKeys.cortexWallet);
  Future<void> setWalletAddress(String addr) =>
      _storage.write(key: StorageKeys.cortexWallet, value: addr);
  Future<void> deleteWalletAddress() =>
      _storage.delete(key: StorageKeys.cortexWallet);

  // Selected model
  Future<String?> getSelectedModel() =>
      _storage.read(key: StorageKeys.selectedModel);
  Future<void> setSelectedModel(String id) =>
      _storage.write(key: StorageKeys.selectedModel, value: id);
  Future<void> deleteSelectedModel() =>
      _storage.delete(key: StorageKeys.selectedModel);

  // Selected agent
  Future<String?> getSelectedAgentId() =>
      _storage.read(key: StorageKeys.selectedAgentId);
  Future<void> setSelectedAgentId(String id) =>
      _storage.write(key: StorageKeys.selectedAgentId, value: id);
  Future<void> deleteSelectedAgentId() =>
      _storage.delete(key: StorageKeys.selectedAgentId);

  /// Wipes all persisted auth state (called on logout).
  Future<void> clearAll() => _storage.deleteAll();
}
