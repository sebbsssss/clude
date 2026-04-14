import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models/conversation.dart';
import '../../shared/utils/model_display_name.dart';
import '../../shared/utils/relative_time.dart';
import '../../shared/widgets/empty_state_widget.dart';
import '../../shared/widgets/error_view.dart';
import '../../core/auth/auth_provider.dart';
import '../balance/balance_chip.dart';
import '../onboarding/onboarding.dart';
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

  @override
  void initState() {
    super.initState();
    Future(() {
      ref.read(modelsNotifierProvider.notifier).fetchModels().then((models) {
        ref.read(selectedModelNotifierProvider.notifier).resolveDefault(models);
      }).catchError((_) {});
    });
  }

  void _checkOnboarding() {
    final conversations =
        ref.read(conversationListNotifierProvider).valueOrNull;
    if (conversations != null) {
      ref.read(onboardingProvider.notifier).checkAndStart();
    }
  }

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
    final onboardingKeys = ref.watch(onboardingKeysProvider);

    // Trigger onboarding check once conversations are loaded.
    ref.listen(conversationListNotifierProvider, (prev, next) {
      if (prev?.valueOrNull == null && next.valueOrNull != null) {
        _checkOnboarding();
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: Text('Conversations', key: onboardingKeys.greeting),
        centerTitle: false,
        titleSpacing: 20,
        actions: [
          ModelChip(key: onboardingKeys.modelChip),
          BalanceChip(key: onboardingKeys.balanceChip),
          const SizedBox(width: 8),
        ],
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
        key: onboardingKeys.fab,
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
      child: InkWell(
        onTap: () => context.go('/chat/${conversation.id}'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: colorScheme.primary.withAlpha(20),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: colorScheme.primary.withAlpha(60)),
                ),
                child: Icon(
                  Icons.chat_bubble_outline_rounded,
                  size: 18,
                  color: colorScheme.primary,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: isMuted
                      ? TextStyle(color: colorScheme.onSurface.withAlpha(120))
                      : const TextStyle(fontWeight: FontWeight.w500),
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    relativeTime(conversation.updatedAt),
                    style: TextStyle(
                      color: colorScheme.onSurface.withAlpha(100),
                      fontSize: 11,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      border: Border.all(color: colorScheme.onSurface.withAlpha(40)),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      modelDisplayName(conversation.model),
                      style: TextStyle(
                        color: colorScheme.onSurface.withAlpha(120),
                        fontSize: 10,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
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
  Timer? _step4Timeout;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _step4Timeout?.cancel();
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
    final onboardingKeys = ref.watch(onboardingKeysProvider);

    // Show error via SnackBar + onboarding auto-advance.
    ref.listen<ChatState>(chatNotifierProvider(widget.conversationId),
        (prev, next) {
      if (next.error != null && prev?.error != next.error) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(next.error!)),
        );
      }

      final currentOnboarding = ref.read(onboardingProvider);
      if (!currentOnboarding.isActive) return;

      // Onboarding step 3: auto-advance when user sends a message.
      if (currentOnboarding.currentStep == 3) {
        final prevCount =
            prev?.settled.where((m) => m.role == 'user').length ?? 0;
        final nextCount = next.settled.where((m) => m.role == 'user').length;
        if (nextCount > prevCount) {
          ref.read(onboardingProvider.notifier).advanceStep();
          // Start timeout for step 4 in case memoryIds never arrive.
          _step4Timeout?.cancel();
          _step4Timeout = Timer(const Duration(seconds: 10), () {
            if (mounted) {
              final s = ref.read(onboardingProvider);
              if (s.isActive && s.currentStep == 4) {
                ref.read(onboardingProvider.notifier).advanceStep();
              }
            }
          });
        }
      }

      // Onboarding step 4: auto-advance when assistant response has memoryIds.
      if (currentOnboarding.currentStep == 4) {
        final hasMemory = next.settled.any(
            (m) => m.role == 'assistant' && m.memoryIds != null && m.memoryIds!.isNotEmpty);
        if (hasMemory) {
          _step4Timeout?.cancel();
          ref.read(onboardingProvider.notifier).advanceStep();
        }
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
                final bubble = MessageBubble(message: items[index]);
                // Attach onboarding key to the latest assistant message for step 4.
                final isStep4Target = index == 0 &&
                    items[index] is SettledMessage &&
                    (items[index] as SettledMessage).role == 'assistant';
                return Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: isStep4Target
                      ? KeyedSubtree(
                          key: onboardingKeys.messageBubble, child: bubble)
                      : bubble,
                );
              },
            ),
          ),
          ChatInputBar(
            key: onboardingKeys.chatInput,
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
