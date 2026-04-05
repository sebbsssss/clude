import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/models/memory_stats.dart';

final memoryStatsProvider =
    StateNotifierProvider<MemoryStatsNotifier, AsyncValue<MemoryStats>>(
  (ref) => MemoryStatsNotifier(ref),
);

class MemoryStatsNotifier extends StateNotifier<AsyncValue<MemoryStats>> {
  MemoryStatsNotifier(this._ref, {bool skipInit = false})
      : super(const AsyncValue.loading()) {
    if (!skipInit) fetch();
  }

  final Ref _ref;
  bool _fetching = false;

  Future<void> fetch() async {
    if (_fetching) return;
    _fetching = true;
    state = const AsyncValue.loading();
    try {
      final client = _ref.read(apiClientProvider);
      final stats = await client.getMemoryStats();
      if (!mounted) return;
      state = AsyncValue.data(stats);
    } catch (e, st) {
      if (!mounted) return;
      state = AsyncValue.error(e, st);
    } finally {
      _fetching = false;
    }
  }

  Future<void> refresh() => fetch();

  @visibleForTesting
  void setStateForTest(AsyncValue<MemoryStats> newState) {
    state = newState;
  }
}
