import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/memory_stats.dart';
import 'package:clude_mobile/core/api/models/memory_summary.dart';
import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/features/memory/memory_screen.dart';
import 'package:clude_mobile/features/memory/memory_stats_provider.dart';
import 'package:clude_mobile/features/memory/recent_memories_provider.dart';
import 'package:clude_mobile/features/memory/recent_memories_state.dart';

class MockApiClient extends Mock implements ApiClient {}

class _MockAuthNotifier extends StateNotifier<AuthState>
    with Mock
    implements AuthNotifier {
  _MockAuthNotifier({bool isAuthenticated = true})
      : super(AuthState(isAuthenticated: isAuthenticated));
}

const _testStats = MemoryStats(
  total: 142,
  byType: {
    'episodic': 52,
    'semantic': 45,
    'procedural': 28,
    'self_model': 17,
  },
  avgImportance: 0.72,
  avgDecay: 0.84,
  topTags: [
    TagCount(tag: 'flutter', count: 18),
  ],
);

final _testMemories = [
  const MemorySummary(
    id: 1,
    memoryType: 'episodic',
    summary: 'Test memory about Flutter',
    importance: 0.8,
    createdAt: '2026-04-05T10:00:00Z',
    decay: 0.9,
  ),
  const MemorySummary(
    id: 2,
    memoryType: 'semantic',
    summary: 'Dart language facts',
    importance: 0.6,
    createdAt: '2026-04-04T08:00:00Z',
    decay: 0.7,
  ),
];

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject({
    bool isAuthenticated = true,
    AsyncValue<MemoryStats>? statsOverride,
    RecentMemoriesState? recentOverride,
  }) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        authNotifierProvider.overrideWith(
          (ref) => _MockAuthNotifier(isAuthenticated: isAuthenticated),
        ),
        if (statsOverride != null)
          memoryStatsProvider.overrideWith(
            (ref) => MemoryStatsNotifier(ref, skipInit: true)
              ..setStateForTest(statsOverride),
          ),
        if (recentOverride != null)
          recentMemoriesProvider.overrideWith(
            (ref) => RecentMemoriesNotifier(ref, skipInit: true)
              ..setStateForTest(recentOverride),
          ),
      ],
      child: const MaterialApp(
        home: MemoryPanelScreen(),
      ),
    );
  }

  group('MemoryPanelScreen', () {
    testWidgets('shows auth gate when unauthenticated', (tester) async {
      await tester.pumpWidget(buildSubject(
        isAuthenticated: false,
        statsOverride: const AsyncValue.loading(),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Sign in to view your memories'), findsOneWidget);
    });

    testWidgets('shows 4 tabs', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Feed'), findsOneWidget);
      expect(find.text('Graph'), findsOneWidget);
      expect(find.text('Entities'), findsOneWidget);
      expect(find.text('Health'), findsOneWidget);
    });

    testWidgets('shows compact stats bar with total and type counts',
        (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('142'), findsOneWidget);
      expect(find.text('memories'), findsOneWidget);
    });

    testWidgets('shows search bar', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Search memories...'), findsOneWidget);
    });

    testWidgets('shows type filter chips', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('All'), findsOneWidget);
      expect(find.text('Episodic'), findsOneWidget);
      expect(find.text('Semantic'), findsOneWidget);
    });

    testWidgets('shows time range buttons', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('24h'), findsOneWidget);
      expect(find.text('3d'), findsOneWidget);
      expect(find.text('1w'), findsOneWidget);
      expect(find.text('30d'), findsOneWidget);
    });

    testWidgets('shows memory feed items', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Test memory about Flutter'), findsOneWidget);
      expect(find.text('Dart language facts'), findsOneWidget);
    });

    testWidgets('shows empty state when no memories', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: const RecentMemoriesState(
          items: [],
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('No memories yet'), findsOneWidget);
    });

    testWidgets('shows Import Memory Pack button', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
        recentOverride: RecentMemoriesState(
          items: _testMemories,
          isLoading: false,
          hasMore: false,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Import Memory Pack'), findsOneWidget);
    });
  });
}
