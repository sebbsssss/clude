import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_provider.dart';
import 'guest_chat_notifier.dart';
import 'models/display_message.dart';
import 'widgets/chat_input_bar.dart';
import 'widgets/message_bubble.dart';

class GuestChatScreen extends ConsumerWidget {
  const GuestChatScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final guestState = ref.watch(guestChatNotifierProvider);
    final isStreaming = guestState.streamingMsg != null;
    final exhausted = guestState.remaining == 0;

    ref.listen<GuestChatState>(guestChatNotifierProvider, (prev, next) {
      if (next.error != null && prev?.error != next.error) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(next.error!)),
        );
      }
    });

    final items = <DisplayMessage>[
      if (guestState.streamingMsg != null) guestState.streamingMsg!,
      ...guestState.settled,
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            ref.read(authNotifierProvider.notifier).logout();
            context.go('/login');
          },
        ),
        actions: [
          if (isStreaming)
            IconButton(
              icon: const Icon(Icons.stop_circle_outlined),
              onPressed: () =>
                  ref.read(guestChatNotifierProvider.notifier).stopStreaming(),
            ),
        ],
      ),
      body: Column(
        children: [
          _GuestBanner(remaining: guestState.remaining),
          Expanded(
            child: ListView.builder(
              reverse: true,
              itemCount: items.length,
              itemBuilder: (context, index) => Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                child: MessageBubble(message: items[index]),
              ),
            ),
          ),
          ChatInputBar(
            enabled: !isStreaming && !exhausted,
            onSubmit: (content) {
              ref.read(guestChatNotifierProvider.notifier).send(content);
            },
          ),
        ],
      ),
    );
  }
}

class _GuestBanner extends ConsumerWidget {
  const _GuestBanner({required this.remaining});

  final int? remaining;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;

    if (remaining == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        color: colorScheme.surfaceContainerHighest,
        child: Text(
          'Guest mode — 10 free messages',
          style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 13),
          textAlign: TextAlign.center,
        ),
      );
    }

    if (remaining! > 0) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        color: colorScheme.primaryContainer,
        child: Text(
          '$remaining/10 free messages remaining',
          style: TextStyle(color: colorScheme.onPrimaryContainer, fontSize: 13),
          textAlign: TextAlign.center,
        ),
      );
    }

    // Exhausted
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: Colors.amber.shade100,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            "You've used all 10 free messages.",
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: () {
              ref.read(authNotifierProvider.notifier).logout();
              context.go('/login');
            },
            child: const Text('Sign in for unlimited access'),
          ),
        ],
      ),
    );
  }
}
