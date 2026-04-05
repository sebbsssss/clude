import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/memory_stats.dart';
import 'package:clude_mobile/features/memory/memory_stats_provider.dart';

class MockApiClient extends Mock implements ApiClient {}

const _testStats = MemoryStats(
  total: 142,
  byType: {
    'episodic': 50,
    'semantic': 40,
    'procedural': 30,
    'self_model': 22,
  },
  avgImportance: 0.72,
  avgDecay: 0.35,
  topTags: [
    TagCount(tag: 'coding', count: 8),
    TagCount(tag: 'work', count: 5),
  ],
);

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  ProviderContainer createContainer({bool skipInit = false}) {
    final container = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        memoryStatsProvider.overrideWith(
          (ref) => MemoryStatsNotifier(ref, skipInit: skipInit),
        ),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('MemoryStatsNotifier', () {
    test('fetches stats successfully', () async {
      when(() => mockClient.getMemoryStats())
          .thenAnswer((_) async => _testStats);

      final container = createContainer(skipInit: true);
      final notifier = container.read(memoryStatsProvider.notifier);
      await notifier.fetch();

      final state = container.read(memoryStatsProvider);
      expect(state, isA<AsyncData<MemoryStats>>());
      expect(state.value!.total, 142);
      expect(state.value!.byType['episodic'], 50);
    });

    test('sets error on failed fetch', () async {
      when(() => mockClient.getMemoryStats())
          .thenThrow(Exception('Server error'));

      final container = createContainer();
      await Future.microtask(() {});
      await Future.microtask(() {});

      final state = container.read(memoryStatsProvider);
      expect(state, isA<AsyncError<MemoryStats>>());
    });

    test('skipInit prevents auto-fetch', () async {
      final container = createContainer(skipInit: true);
      await Future.microtask(() {});

      final state = container.read(memoryStatsProvider);
      expect(state, isA<AsyncLoading<MemoryStats>>());
      verifyNever(() => mockClient.getMemoryStats());
    });

    test('refresh re-fetches', () async {
      when(() => mockClient.getMemoryStats())
          .thenAnswer((_) async => _testStats);

      final container = createContainer(skipInit: true);
      final notifier = container.read(memoryStatsProvider.notifier);

      await notifier.refresh();

      final state = container.read(memoryStatsProvider);
      expect(state.value!.total, 142);
      verify(() => mockClient.getMemoryStats()).called(1);
    });
  });
}
