import 'package:flutter/material.dart';

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

class ActiveChatScreen extends StatelessWidget {
  const ActiveChatScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Chat $conversationId')),
      body: const Center(child: Text('Active Chat')),
    );
  }
}
