import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/models/chat_model.dart';
import '../../core/storage/secure_storage_provider.dart';

// ---------------------------------------------------------------------------
// Models list with 60s TTL cache
// ---------------------------------------------------------------------------

final modelsNotifierProvider =
    StateNotifierProvider<ModelsNotifier, AsyncValue<List<ChatModel>>>(
  (ref) => ModelsNotifier(ref),
);

class ModelsNotifier extends StateNotifier<AsyncValue<List<ChatModel>>> {
  ModelsNotifier(this._ref) : super(const AsyncLoading());

  final Ref _ref;
  List<ChatModel>? _cache;
  DateTime? _fetchedAt;

  static const _ttl = Duration(seconds: 60);

  Future<List<ChatModel>> fetchModels() async {
    if (_cache != null &&
        _fetchedAt != null &&
        DateTime.now().difference(_fetchedAt!) < _ttl) {
      return _cache!;
    }

    state = const AsyncLoading();
    try {
      final client = _ref.read(apiClientProvider);
      final models = await client.getModels();
      _cache = models;
      _fetchedAt = DateTime.now();
      state = AsyncData(models);
      return models;
    } catch (e, st) {
      _cache = null;
      _fetchedAt = null;
      state = AsyncError(e, st);
      rethrow;
    }
  }
}

// ---------------------------------------------------------------------------
// Selected model persisted to secure storage
// ---------------------------------------------------------------------------

final selectedModelNotifierProvider =
    StateNotifierProvider<SelectedModelNotifier, String?>(
  (ref) => SelectedModelNotifier(ref),
);

class SelectedModelNotifier extends StateNotifier<String?> {
  SelectedModelNotifier(this._ref) : super(null) {
    _init();
  }

  final Ref _ref;

  Future<void> _init() async {
    final stored = await _ref.read(secureStorageProvider).getSelectedModel();
    if (mounted) state = stored;
  }

  Future<void> selectModel(String id) async {
    await _ref.read(secureStorageProvider).setSelectedModel(id);
    state = id;
  }

  /// If current selection is null or not in the models list, pick the default.
  void resolveDefault(List<ChatModel> models) {
    if (models.isEmpty) return;
    final current = state;
    final exists = current != null && models.any((m) => m.id == current);
    if (!exists) {
      final defaultModel = models.where((m) => m.isDefault).firstOrNull;
      final id = defaultModel?.id ?? models.first.id;
      selectModel(id);
    }
  }

  /// On logout, if the selected model is pro tier, downgrade to first free.
  void downgradeIfPro(List<ChatModel> models) {
    if (models.isEmpty) return;
    final current = state;
    if (current == null) return;
    final model = models.where((m) => m.id == current).firstOrNull;
    if (model != null && model.tier == 'pro') {
      final free = models.where((m) => m.tier == 'free').firstOrNull;
      if (free != null) selectModel(free.id);
    }
  }
}
