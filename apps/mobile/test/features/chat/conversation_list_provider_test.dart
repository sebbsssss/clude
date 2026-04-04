import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/conversation.dart';
import 'package:clude_mobile/features/chat/conversation_list_provider.dart';

class MockApiClient extends Mock implements ApiClient {}

Conversation _conv(String id, {String? title, String updatedAt = '2026-04-01T00:00:00Z'}) {
  return Conversation(
    id: id,
    ownerWallet: 'wallet-1',
    title: title,
    model: 'claude-3',
    messageCount: 1,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: updatedAt,
  );
}

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
      ],
    );
  }

  group('ConversationListNotifier', () {
    test('build fetches and sorts conversations by updatedAt desc', () async {
      final older = _conv('1', title: 'Older', updatedAt: '2026-04-01T00:00:00Z');
      final newer = _conv('2', title: 'Newer', updatedAt: '2026-04-02T00:00:00Z');
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [older, newer]);

      final container = createContainer();
      addTearDown(container.dispose);

      final result = await container.read(conversationListNotifierProvider.future);
      expect(result.map((c) => c.id).toList(), ['2', '1']);
    });

    test('build returns empty list when no conversations', () async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => []);

      final container = createContainer();
      addTearDown(container.dispose);

      final result = await container.read(conversationListNotifierProvider.future);
      expect(result, isEmpty);
    });

    test('build propagates error as AsyncError', () async {
      when(() => mockClient.listConversations())
          .thenThrow(Exception('Network error'));

      final container = createContainer();
      addTearDown(container.dispose);

      // Let it build and fail.
      await expectLater(
        container.read(conversationListNotifierProvider.future),
        throwsA(isA<Exception>()),
      );
    });

    test('createConversation prepends new conversation and returns it', () async {
      final existing = _conv('1', title: 'Existing');
      final created = _conv('2', title: 'Created');
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [existing]);
      when(() => mockClient.createConversation())
          .thenAnswer((_) async => created);

      final container = createContainer();
      addTearDown(container.dispose);

      await container.read(conversationListNotifierProvider.future);
      final notifier = container.read(conversationListNotifierProvider.notifier);

      final result = await notifier.createConversation();
      expect(result.id, '2');

      final state = container.read(conversationListNotifierProvider);
      expect(state.value!.first.id, '2');
      expect(state.value!.length, 2);
    });

    test('deleteConversation removes item optimistically', () async {
      final conversations = [_conv('1'), _conv('2')];
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => conversations);
      when(() => mockClient.deleteConversation('1'))
          .thenAnswer((_) async {});

      final container = createContainer();
      addTearDown(container.dispose);

      await container.read(conversationListNotifierProvider.future);
      final notifier = container.read(conversationListNotifierProvider.notifier);

      await notifier.deleteConversation('1');

      final state = container.read(conversationListNotifierProvider);
      expect(state.value!.length, 1);
      expect(state.value!.first.id, '2');
    });

    test('deleteConversation restores item on API failure', () async {
      final conversations = [_conv('1'), _conv('2')];
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => conversations);
      when(() => mockClient.deleteConversation('1'))
          .thenThrow(Exception('Server error'));

      final container = createContainer();
      addTearDown(container.dispose);

      await container.read(conversationListNotifierProvider.future);
      final notifier = container.read(conversationListNotifierProvider.notifier);

      await expectLater(
        notifier.deleteConversation('1'),
        throwsA(isA<Exception>()),
      );

      final state = container.read(conversationListNotifierProvider);
      expect(state.value!.length, 2);
      expect(state.value!.first.id, '1');
    });

    test('deleteConversation is no-op for unknown id', () async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1')]);

      final container = createContainer();
      addTearDown(container.dispose);

      await container.read(conversationListNotifierProvider.future);
      final notifier = container.read(conversationListNotifierProvider.notifier);

      await notifier.deleteConversation('unknown');

      verifyNever(() => mockClient.deleteConversation(any()));
    });

    test('refresh re-fetches from API', () async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1')]);

      final container = createContainer();
      addTearDown(container.dispose);

      await container.read(conversationListNotifierProvider.future);

      // Second call returns updated list.
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1'), _conv('2')]);

      final notifier = container.read(conversationListNotifierProvider.notifier);
      await notifier.refresh();

      final state = container.read(conversationListNotifierProvider);
      expect(state.value!.length, 2);
    });
  });
}
