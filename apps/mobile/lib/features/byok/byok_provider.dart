import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/storage/secure_storage.dart';
import '../../core/storage/secure_storage_provider.dart';

const byokProviders = SecureStorageService.byokProviderNames;

const byokPrefixHints = <String, String>{
  'anthropic': 'sk-ant-',
  'openai': 'sk-',
  'google': 'AIza',
  'xai': 'xai-',
  'deepseek': 'sk-',
  'minimax': 'eyJ',
};

const byokDocsUrls = <String, String>{
  'anthropic': 'https://console.anthropic.com/settings/keys',
  'openai': 'https://platform.openai.com/api-keys',
  'google': 'https://aistudio.google.com/apikey',
  'xai': 'https://console.x.ai',
  'deepseek': 'https://platform.deepseek.com/api_keys',
  'minimax': 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
};

final byokKeysNotifierProvider =
    StateNotifierProvider<ByokKeysNotifier, Map<String, String>>(
  (ref) => ByokKeysNotifier(ref),
);

class ByokKeysNotifier extends StateNotifier<Map<String, String>> {
  ByokKeysNotifier(this._ref) : super(const {}) {
    loadKeys();
  }

  final Ref _ref;

  Future<void> loadKeys() async {
    final storage = _ref.read(secureStorageProvider);
    final keys = <String, String>{};
    for (final provider in byokProviders) {
      final key = await storage.getByokKey(provider);
      if (key != null) keys[provider] = key;
    }
    if (mounted) state = keys;
  }

  Future<void> setKey(String provider, String key) async {
    await _ref.read(secureStorageProvider).setByokKey(provider, key);
    state = {...state, provider: key};
  }

  Future<void> removeKey(String provider) async {
    await _ref.read(secureStorageProvider).deleteByokKey(provider);
    final updated = {...state}..remove(provider);
    state = updated;
  }

  bool hasKeyFor(String? provider) =>
      provider != null && state.containsKey(provider);

  Future<void> clearAll() async {
    await _ref.read(secureStorageProvider).deleteAllByokKeys();
    state = const {};
  }
}

bool validateByokKeyFormat(String provider, String key) {
  final prefix = byokPrefixHints[provider];
  if (prefix == null || key.isEmpty) return false;
  return key.startsWith(prefix);
}
