import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../../core/api/models/conversation.dart';

final conversationListNotifierProvider =
    AsyncNotifierProvider<ConversationListNotifier, List<Conversation>>(
  ConversationListNotifier.new,
);

class ConversationListNotifier extends AsyncNotifier<List<Conversation>> {
  @override
  Future<List<Conversation>> build() async {
    final client = ref.read(apiClientProvider);
    final conversations = await client.listConversations();
    return _sortByUpdated(conversations);
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final client = ref.read(apiClientProvider);
      final conversations = await client.listConversations();
      return _sortByUpdated(conversations);
    });
  }

  Future<Conversation> createConversation() async {
    final client = ref.read(apiClientProvider);
    final conversation = await client.createConversation();
    final current = state.valueOrNull ?? [];
    state = AsyncData([conversation, ...current]);
    return conversation;
  }

  Future<void> deleteConversation(String id) async {
    final current = state.valueOrNull ?? [];
    final index = current.indexWhere((c) => c.id == id);
    if (index == -1) return;

    final removed = current[index];
    state = AsyncData([...current]..removeAt(index));

    try {
      await ref.read(apiClientProvider).deleteConversation(id);
    } catch (e) {
      // Restore on failure.
      final restored = state.valueOrNull ?? [];
      state = AsyncData([...restored]..insert(index, removed));
      rethrow;
    }
  }

  void updateTitle(String conversationId, String title) {
    final current = state.valueOrNull;
    if (current == null) return;
    final index = current.indexWhere((c) => c.id == conversationId);
    if (index == -1) return;
    final updated = current[index].copyWith(title: title);
    state = AsyncData([...current]..[index] = updated);
  }

  List<Conversation> _sortByUpdated(List<Conversation> list) {
    return [...list]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }
}
