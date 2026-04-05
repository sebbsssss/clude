import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/graph_data.dart';
import 'package:clude_mobile/features/memory/graph_provider.dart';

class MockApiClient extends Mock implements ApiClient {}

const _testGraph = GraphData(
  nodes: [
    GraphNode(
      id: 1,
      type: 'episodic',
      summary: 'Test memory',
      content: 'Full content',
      tags: ['coding'],
      importance: 0.8,
      decay: 0.3,
    ),
    GraphNode(
      id: 2,
      type: 'semantic',
      summary: 'Another memory',
      content: 'More content',
      tags: ['work'],
      importance: 0.5,
      decay: 0.6,
    ),
  ],
  links: [
    GraphLink(
      sourceId: 1,
      targetId: 2,
      linkType: 'relates',
      strength: 0.7,
    ),
  ],
  total: 2,
);

const _emptyGraph = GraphData(nodes: [], links: [], total: 0);

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

  group('graphProvider', () {
    test('returns graph data on success', () async {
      when(() => mockClient.getMemoryGraph(limit: 200))
          .thenAnswer((_) async => _testGraph);

      final container = createContainer();
      final result = await container.read(graphProvider.future);

      expect(result.nodes.length, 2);
      expect(result.links.length, 1);
      expect(result.total, 2);
    });

    test('returns error on API failure', () async {
      when(() => mockClient.getMemoryGraph(limit: 200))
          .thenThrow(Exception('Server error'));

      final container = createContainer();

      expect(
        () => container.read(graphProvider.future),
        throwsA(isA<Exception>()),
      );
    });

    test('empty graph returned correctly', () async {
      when(() => mockClient.getMemoryGraph(limit: 200))
          .thenAnswer((_) async => _emptyGraph);

      final container = createContainer();
      final result = await container.read(graphProvider.future);

      expect(result.nodes, isEmpty);
      expect(result.links, isEmpty);
      expect(result.total, 0);
    });

    test('invalidate re-fetches', () async {
      when(() => mockClient.getMemoryGraph(limit: 200))
          .thenAnswer((_) async => _testGraph);

      final container = createContainer();
      await container.read(graphProvider.future);

      when(() => mockClient.getMemoryGraph(limit: 200))
          .thenAnswer((_) async => _emptyGraph);

      container.invalidate(graphProvider);
      final result = await container.read(graphProvider.future);

      expect(result.nodes, isEmpty);
      verify(() => mockClient.getMemoryGraph(limit: 200)).called(2);
    });
  });
}
