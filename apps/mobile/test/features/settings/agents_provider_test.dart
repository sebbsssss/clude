import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/agent.dart';
import 'package:clude_mobile/features/settings/agents_provider.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  group('agentsProvider', () {
    late MockApiClient mockClient;

    setUp(() {
      mockClient = MockApiClient();
    });

    test('fetches agents from API', () async {
      when(() => mockClient.listAgents()).thenAnswer(
        (_) async => [
          const Agent(id: '1', name: 'Agent One', createdAt: '2026-01-01'),
          const Agent(id: '2', name: 'Agent Two', createdAt: '2026-01-02'),
        ],
      );

      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(mockClient),
        ],
      );
      addTearDown(container.dispose);

      final agents = await container.read(agentsProvider.future);

      expect(agents, hasLength(2));
      expect(agents[0].name, 'Agent One');
      expect(agents[1].name, 'Agent Two');
    });

    test('returns empty list when API returns empty', () async {
      when(() => mockClient.listAgents())
          .thenAnswer((_) async => <Agent>[]);

      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(mockClient),
        ],
      );
      addTearDown(container.dispose);

      final agents = await container.read(agentsProvider.future);

      expect(agents, isEmpty);
    });
  });
}
