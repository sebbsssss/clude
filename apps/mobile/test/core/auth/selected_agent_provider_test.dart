import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/models/agent.dart';
import 'package:clude_mobile/core/auth/selected_agent_provider.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

void main() {
  group('SelectedAgentNotifier', () {
    late MockSecureStorage mockStorage;

    setUp(() {
      mockStorage = MockSecureStorage();
    });

    ProviderContainer createContainer({String? storedAgentId}) {
      when(() => mockStorage.getSelectedAgentId())
          .thenAnswer((_) async => storedAgentId);
      when(() => mockStorage.setSelectedAgentId(any()))
          .thenAnswer((_) async {});

      return ProviderContainer(
        overrides: [
          secureStorageProvider.overrideWithValue(mockStorage),
        ],
      );
    }

    test('restores agent ID from storage on build', () async {
      final container = createContainer(storedAgentId: 'agent-saved');
      addTearDown(container.dispose);

      await container.read(selectedAgentNotifierProvider.future);

      final state = container.read(selectedAgentNotifierProvider);
      expect(state.value, 'agent-saved');
    });

    test('returns null when no agent stored', () async {
      final container = createContainer(storedAgentId: null);
      addTearDown(container.dispose);

      await container.read(selectedAgentNotifierProvider.future);

      final state = container.read(selectedAgentNotifierProvider);
      expect(state.value, isNull);
    });

    test('selectAgent persists to storage and updates state', () async {
      final container = createContainer(storedAgentId: null);
      addTearDown(container.dispose);

      await container.read(selectedAgentNotifierProvider.future);

      final notifier = container.read(selectedAgentNotifierProvider.notifier);
      await notifier.selectAgent('agent-new');

      final state = container.read(selectedAgentNotifierProvider);
      expect(state.value, 'agent-new');
      verify(() => mockStorage.setSelectedAgentId('agent-new')).called(1);
    });

    test('autoSelectIfSingle selects when one agent and none stored', () async {
      final container = createContainer(storedAgentId: null);
      addTearDown(container.dispose);

      await container.read(selectedAgentNotifierProvider.future);

      final notifier = container.read(selectedAgentNotifierProvider.notifier);
      await notifier.autoSelectIfSingle([
        const Agent(id: 'solo-agent', name: 'Solo', createdAt: '2026-01-01'),
      ]);

      expect(container.read(selectedAgentNotifierProvider).value, 'solo-agent');
      verify(() => mockStorage.setSelectedAgentId('solo-agent')).called(1);
    });

    test('autoSelectIfSingle is no-op when agent already selected', () async {
      final container = createContainer(storedAgentId: 'existing');
      addTearDown(container.dispose);

      await container.read(selectedAgentNotifierProvider.future);

      final notifier = container.read(selectedAgentNotifierProvider.notifier);
      await notifier.autoSelectIfSingle([
        const Agent(id: 'solo-agent', name: 'Solo', createdAt: '2026-01-01'),
      ]);

      // Should keep existing, not overwrite
      expect(container.read(selectedAgentNotifierProvider).value, 'existing');
      verifyNever(() => mockStorage.setSelectedAgentId(any()));
    });

    test('autoSelectIfSingle is no-op when multiple agents', () async {
      final container = createContainer(storedAgentId: null);
      addTearDown(container.dispose);

      await container.read(selectedAgentNotifierProvider.future);

      final notifier = container.read(selectedAgentNotifierProvider.notifier);
      await notifier.autoSelectIfSingle([
        const Agent(id: '1', name: 'A', createdAt: '2026-01-01'),
        const Agent(id: '2', name: 'B', createdAt: '2026-01-02'),
      ]);

      expect(container.read(selectedAgentNotifierProvider).value, isNull);
      verifyNever(() => mockStorage.setSelectedAgentId(any()));
    });
  });
}
