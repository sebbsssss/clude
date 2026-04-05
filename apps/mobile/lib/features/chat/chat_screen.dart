import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models/conversation.dart';
import '../../shared/utils/relative_time.dart';
import '../../shared/widgets/empty_state_widget.dart';
import '../../shared/widgets/error_view.dart';
import '../../core/auth/auth_provider.dart';
import '../balance/balance_chip.dart';
import 'chat_provider.dart';
import 'chat_state.dart';
import 'conversation_list_provider.dart';
import 'models/display_message.dart';
import 'models_provider.dart';
import 'widgets/chat_input_bar.dart';
import 'widgets/message_bubble.dart';
import 'widgets/model_chip.dart';

class ConversationListScreen extends ConsumerStatefulWidget {
  const ConversationListScreen({super.key});

  @override
  ConsumerState<ConversationListScreen> createState() =>
      _ConversationListScreenState();
}

class _ConversationListScreenState
    extends ConsumerState<ConversationListScreen> {
  bool _isCreating = false;

  Future<void> _createConversation() async {
    if (_isCreating) return;
    setState(() => _isCreating = true);
    try {
      final conversation = await ref
          .read(conversationListNotifierProvider.notifier)
          .createConversation();
      if (mounted) context.go('/chat/${conversation.id}');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to create conversation: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncConversations = ref.watch(conversationListNotifierProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Conversations'),
        actions: const [BalanceChip(), ModelChip()],
      ),
      body: asyncConversations.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(conversationListNotifierProvider),
        ),
        data: (conversations) => conversations.isEmpty
            ? const EmptyStateWidget(
                title: 'No conversations yet',
                subtitle: 'Tap + to start chatting',
                icon: Icons.chat_bubble_outline,
              )
            : RefreshIndicator(
                onRefresh: () => ref
                    .read(conversationListNotifierProvider.notifier)
                    .refresh(),
                child: ListView.builder(
                  itemCount: conversations.length,
                  itemBuilder: (context, index) => _ConversationTile(
                    conversation: conversations[index],
                  ),
                ),
              ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _isCreating ? null : _createConversation,
        child: _isCreating
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.add),
      ),
    );
  }
}

class _ConversationTile extends ConsumerWidget {
  const _ConversationTile({required this.conversation});

  final Conversation conversation;

  Future<bool?> _confirmDelete(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete conversation?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final title = conversation.title ?? 'New conversation';
    final isMuted = conversation.title == null;

    return Dismissible(
      key: ValueKey(conversation.id),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) async {
        final confirmed = await _confirmDelete(context);
        if (confirmed != true) return false;
        try {
          await ref
              .read(conversationListNotifierProvider.notifier)
              .deleteConversation(conversation.id);
        } catch (e) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Failed to delete: $e')),
            );
          }
        }
        // Always return false — the provider state drives list removal.
        return false;
      },
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: colorScheme.error,
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: colorScheme.secondary,
          radius: 20,
          child: Icon(
            Icons.chat_bubble_outline,
            size: 18,
            color: colorScheme.onSecondary,
          ),
        ),
        title: Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: isMuted
              ? TextStyle(color: colorScheme.onSurface.withAlpha(120))
              : null,
        ),
        subtitle: Text(
          '${relativeTime(conversation.updatedAt)} · ${conversation.model}',
          style: TextStyle(
            color: colorScheme.onSurface.withAlpha(100),
            fontSize: 12,
          ),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: colorScheme.primary.withAlpha(30),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            '${conversation.messageCount}',
            style: TextStyle(color: colorScheme.primary, fontSize: 12),
          ),
        ),
        onTap: () => context.go('/chat/${conversation.id}'),
      ),
    );
  }
}

class ActiveChatScreen extends ConsumerStatefulWidget {
  const ActiveChatScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<ActiveChatScreen> createState() => _ActiveChatScreenState();
}

class _ActiveChatScreenState extends ConsumerState<ActiveChatScreen>
    with WidgetsBindingObserver {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _cancelStream();
    } else if (state == AppLifecycleState.resumed) {
      _refreshConversation();
    }
  }

  void _cancelStream() {
    ref.read(chatNotifierProvider(widget.conversationId).notifier).stopStreaming();
  }

  void _refreshConversation() {
    ref
        .read(chatNotifierProvider(widget.conversationId).notifier)
        .loadInitial(widget.conversationId);
  }

  void _onScroll() {
    final pos = _scrollController.position;
    if (pos.pixels >= pos.maxScrollExtent - 200) {
      ref.read(chatNotifierProvider(widget.conversationId).notifier).loadOlder();
    }
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(chatNotifierProvider(widget.conversationId));
    final selectedModelId = ref.watch(selectedModelNotifierProvider);
    final isStreaming = chatState.streamingMsg != null;

    // Show error via SnackBar.
    ref.listen<ChatState>(chatNotifierProvider(widget.conversationId),
        (prev, next) {
      if (next.error != null && prev?.error != next.error) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(next.error!)),
        );
      }
    });

    // Auto-downgrade pro model on logout.
    ref.listen(authNotifierProvider, (prev, next) {
      if (prev?.isAuthenticated == true && !next.isAuthenticated) {
        final models = ref.read(modelsNotifierProvider).valueOrNull;
        if (models != null) {
          ref.read(selectedModelNotifierProvider.notifier).downgradeIfPro(models);
        }
      }
    });

    final items = <DisplayMessage>[
      if (chatState.streamingMsg != null) chatState.streamingMsg!,
      ...chatState.settled,
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(chatState.title ?? 'New Chat'),
        actions: [
          const BalanceChip(),
          const ModelChip(),
          if (isStreaming)
            IconButton(
              icon: const Icon(Icons.stop_circle_outlined),
              onPressed: () => ref
                  .read(chatNotifierProvider(widget.conversationId).notifier)
                  .stopStreaming(),
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              reverse: true,
              itemCount: items.length + (chatState.isLoadingOlder ? 1 : 0),
              itemBuilder: (context, index) {
                if (chatState.isLoadingOlder && index == items.length) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: CircularProgressIndicator(),
                    ),
                  );
                }
                return Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: MessageBubble(message: items[index]),
                );
              },
            ),
          ),
          ChatInputBar(
            enabled: !isStreaming,
            onSubmit: (content) {
              final model = selectedModelId ?? chatState.model ?? 'claude-sonnet-4-20250514';
              ref
                  .read(chatNotifierProvider(widget.conversationId).notifier)
                  .send(content, model);
            },
          ),
        ],
      ),
    );
  }
}
