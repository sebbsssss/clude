import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/entity_data.dart';
import 'package:clude_mobile/features/memory/entities_provider.dart';

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

const _testDetail = EntityDetail(
  entity: GraphEntity(
    id: 1,
    type: 'person',
    name: 'Alice',
    mentionCount: 5,
    lastSeen: '2026-03-30T10:00:00Z',
  ),
  memories: [
    EntityMemory(
      id: 101,
      type: 'episodic',
      summary: 'Met Alice at conference',
      importance: 0.8,
      createdAt: '2026-03-30T10:00:00Z',
    ),
  ],
  relatedEntities: [
    RelatedEntity(entityId: 2, cooccurrenceCount: 3, avgSalience: 0.7),
  ],
);

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  ProviderContainer createContainer() {
    final container = ProviderContainer(
      overrides: [apiClientProvider.overrideWithValue(mockClient)],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('entitiesProvider', () {
    test('returns entity list on success', () async {
      when(() => mockClient.getEntities())
          .thenAnswer((_) async => _testEntities);

      final container = createContainer();
      final result = await container.read(entitiesProvider.future);

      expect(result.length, 3);
      expect(result.first.name, 'Alice');
    });

    test('returns error on failure', () async {
      when(() => mockClient.getEntities())
          .thenThrow(Exception('Server error'));

      final container = createContainer();

      expect(
        () => container.read(entitiesProvider.future),
        throwsA(isA<Exception>()),
      );
    });
  });

  group('entitySearchProvider', () {
    test('returns filtered results', () async {
      when(() => mockClient.searchEntities('Alice'))
          .thenAnswer((_) async => [_testEntities.first]);

      final container = createContainer();
      final result =
          await container.read(entitySearchProvider('Alice').future);

      expect(result.length, 1);
      expect(result.first.name, 'Alice');
    });
  });

  group('entityDetailProvider', () {
    test('returns detail with memories', () async {
      when(() => mockClient.getEntityDetail(1))
          .thenAnswer((_) async => _testDetail);

      final container = createContainer();
      final result = await container.read(entityDetailProvider(1).future);

      expect(result.entity.name, 'Alice');
      expect(result.memories.length, 1);
      expect(result.relatedEntities.length, 1);
    });

    test('returns error on failure', () async {
      when(() => mockClient.getEntityDetail(1))
          .thenThrow(Exception('Not found'));

      final container = createContainer();

      expect(
        () => container.read(entityDetailProvider(1).future),
        throwsA(isA<Exception>()),
      );
    });
  });
}
