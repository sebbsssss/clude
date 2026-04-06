import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/entity_data.dart';
import 'package:clude_mobile/features/memory/entities_provider.dart';
import 'package:clude_mobile/features/memory/entities_tab.dart';

class MockApiClient extends Mock implements ApiClient {}

const _testEntities = [
  GraphEntity(
    id: 1,
    type: 'person',
    name: 'Alice',
    mentionCount: 5,
    lastSeen: '2026-03-30T10:00:00Z',
  ),
  GraphEntity(
    id: 2,
    type: 'concept',
    name: 'Flutter',
    mentionCount: 12,
    lastSeen: '2026-03-29T08:00:00Z',
  ),
  GraphEntity(
    id: 3,
    type: 'person',
    name: 'Bob',
    mentionCount: 3,
    lastSeen: '2026-03-28T15:00:00Z',
  ),
];

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject({
    AsyncValue<List<GraphEntity>>? entitiesOverride,
  }) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        if (entitiesOverride != null)
          entitiesProvider.overrideWith((ref) {
            return entitiesOverride.when(
              data: (d) => Future.value(d),
              loading: () =>
                  Future.delayed(const Duration(days: 1), () => <GraphEntity>[]),
              error: (e, _) => Future.error(e ?? 'error'),
            );
          }),
      ],
      child: const MaterialApp(
        home: Scaffold(body: EntitiesTab()),
      ),
    );
  }

  group('EntitiesTab', () {
    testWidgets('shows grouped sections with entity names', (tester) async {
      await tester.pumpWidget(buildSubject(
        entitiesOverride: const AsyncValue.data(_testEntities),
      ));
      await tester.pumpAndSettle();

      expect(find.text('People'), findsOneWidget);
      expect(find.text('Concepts'), findsOneWidget);
      expect(find.text('Alice'), findsOneWidget);
      expect(find.text('Flutter'), findsOneWidget);
    });

    testWidgets('shows empty state when no entities', (tester) async {
      await tester.pumpWidget(buildSubject(
        entitiesOverride: const AsyncValue.data([]),
      ));
      await tester.pumpAndSettle();

      expect(find.text('No entities yet'), findsOneWidget);
    });

    testWidgets('hides groups with 0 entities', (tester) async {
      await tester.pumpWidget(buildSubject(
        entitiesOverride: const AsyncValue.data(_testEntities),
      ));
      await tester.pumpAndSettle();

      // Only person and concept types exist — others hidden
      expect(find.text('People'), findsOneWidget);
      expect(find.text('Concepts'), findsOneWidget);
      expect(find.text('Projects'), findsNothing);
      expect(find.text('Tokens'), findsNothing);
    });

    testWidgets('shows search field', (tester) async {
      await tester.pumpWidget(buildSubject(
        entitiesOverride: const AsyncValue.data(_testEntities),
      ));
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('shows error with retry', (tester) async {
      await tester.pumpWidget(buildSubject(
        entitiesOverride:
            AsyncValue.error(Exception('Server error'), StackTrace.current),
      ));
      await tester.pumpAndSettle();

      expect(find.textContaining('Server error'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });
  });
}
