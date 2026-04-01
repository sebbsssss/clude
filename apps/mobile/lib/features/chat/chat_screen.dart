import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ConversationListScreen extends StatelessWidget {
  const ConversationListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Chat')),
      body: const Center(child: Text('Conversation List')),
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
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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

  /// Cancel active SSE streams. Wired to chatNotifier in spec 010.
  void _cancelStream() {
    // TODO(spec-010): ref.read(chatNotifierProvider.notifier).cancelStream();
  }

  /// Re-fetch conversation after resume. Wired to chatNotifier in spec 010.
  void _refreshConversation() {
    // TODO(spec-010): ref.read(chatNotifierProvider.notifier).refreshConversation();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Chat ${widget.conversationId}')),
      body: const Center(child: Text('Active Chat')),
    );
  }
}
