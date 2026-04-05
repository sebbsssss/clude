import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/memory_stats.dart';
import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/features/memory/memory_screen.dart';
import 'package:clude_mobile/features/memory/memory_stats_provider.dart';

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

const _emptyTagsStats = MemoryStats(
  total: 10,
  byType: {'episodic': 10},
  avgImportance: 0.5,
  avgDecay: 0.2,
  topTags: [],
);

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject({
    bool isAuthenticated = true,
    AsyncValue<MemoryStats>? statsOverride,
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
      expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    });

    testWidgets('shows loading indicator', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.loading(),
      ));
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows total memory count', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
      ));
      await tester.pumpAndSettle();

      expect(find.text('142'), findsOneWidget);
      expect(find.text('total memories'), findsOneWidget);
    });

    testWidgets('shows by-type rows with counts', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Episodic'), findsOneWidget);
      expect(find.text('50'), findsOneWidget);
      expect(find.text('Semantic'), findsOneWidget);
      expect(find.text('40'), findsOneWidget);
      expect(find.text('Procedural'), findsOneWidget);
      expect(find.text('30'), findsOneWidget);
      expect(find.text('Self Model'), findsOneWidget);
      expect(find.text('22'), findsOneWidget);
    });

    testWidgets('shows importance progress bar', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Avg importance'), findsOneWidget);
      expect(find.text('72%'), findsOneWidget);
    });

    testWidgets('shows decay progress bar', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Avg decay'), findsOneWidget);
      expect(find.text('35%'), findsOneWidget);
      expect(find.text('lower is fresher'), findsOneWidget);
    });

    testWidgets('shows tag chips', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_testStats),
      ));
      await tester.pumpAndSettle();

      expect(find.text('coding (8)'), findsOneWidget);
      expect(find.text('work (5)'), findsOneWidget);
    });

    testWidgets('hides tags section when empty', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: const AsyncValue.data(_emptyTagsStats),
      ));
      await tester.pumpAndSettle();

      expect(find.byType(Chip), findsNothing);
    });

    testWidgets('shows error with retry button', (tester) async {
      await tester.pumpWidget(buildSubject(
        statsOverride: AsyncValue.error(Exception('Server error'), StackTrace.current),
      ));
      await tester.pumpAndSettle();

      expect(find.textContaining('Server error'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });
  });
}
