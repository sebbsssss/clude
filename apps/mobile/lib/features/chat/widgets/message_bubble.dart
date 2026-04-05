import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/display_message.dart';
import 'greeting_meta_bar.dart';
import 'message_detail_sheet.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.message});

  final DisplayMessage message;

  @override
  Widget build(BuildContext context) {
    return switch (message) {
      SettledMessage m => _SettledBubble(message: m),
      StreamingMessage m => _StreamingBubble(message: m),
    };
  }
}

const _kTypeColors = [
  Color(0xFF2244FF), // episodic
  Color(0xFF10B981), // semantic
  Color(0xFFF59E0B), // procedural
  Color(0xFF8B5CF6), // self_model
];

class _SettledBubble extends StatelessWidget {
  const _SettledBubble({required this.message});

  final SettledMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';
    final colorScheme = Theme.of(context).colorScheme;
    final hasMemories =
        !isUser && message.memoryIds != null && message.memoryIds!.isNotEmpty;

    final bubble = Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.78,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser ? colorScheme.primary : colorScheme.secondary,
                borderRadius: BorderRadius.circular(16),
              ),
              child: isUser
                  ? Text(
                      message.content,
                      style: TextStyle(color: colorScheme.onPrimary),
                    )
                  : MarkdownBody(
                      data: message.content,
                      shrinkWrap: true,
                      styleSheet: _mdStyle(context, colorScheme),
                      onTapLink: (text, href, title) {
                        if (href != null) launchUrl(Uri.parse(href));
                      },
                    ),
            ),
            if (hasMemories) _MemoryPillRow(memoryIds: message.memoryIds!),
            if (message.isGreeting &&
                message.greetingMeta != null &&
                message.greetingMeta!.totalMemories > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: GreetingMetaBar(meta: message.greetingMeta!),
              ),
            if (message.createdAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  DateFormat.jm().format(DateTime.parse(message.createdAt!)),
                  style: TextStyle(
                    color: colorScheme.onSurface.withAlpha(80),
                    fontSize: 10,
                  ),
                ),
              ),
          ],
        ),
      ),
    );

    if (isUser) return bubble;

    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: () => MessageDetailSheet.show(context, message),
      child: bubble,
    );
  }

  MarkdownStyleSheet _mdStyle(BuildContext context, ColorScheme cs) {
    final base = TextStyle(color: cs.onSecondary);
    return MarkdownStyleSheet(
      p: base,
      h1: base.copyWith(fontSize: 24, fontWeight: FontWeight.bold),
      h2: base.copyWith(fontSize: 20, fontWeight: FontWeight.bold),
      h3: base.copyWith(fontSize: 18, fontWeight: FontWeight.bold),
      h4: base.copyWith(fontSize: 16, fontWeight: FontWeight.bold),
      strong: base.copyWith(fontWeight: FontWeight.bold),
      em: base.copyWith(fontStyle: FontStyle.italic),
      code: base.copyWith(fontFamily: 'monospace'),
      codeblockDecoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(8),
      ),
      listBullet: base,
      a: base.copyWith(decoration: TextDecoration.underline),
    );
  }
}

class _MemoryPillRow extends StatelessWidget {
  const _MemoryPillRow({required this.memoryIds});

  final List<int> memoryIds;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: memoryIds.map((id) {
          final color = _kTypeColors[id % _kTypeColors.length];
          return Chip(
            label: Text(
              '$id',
              style: TextStyle(fontSize: 11, color: color),
            ),
            backgroundColor: color.withAlpha(30),
            side: BorderSide(color: color.withAlpha(76)),
            padding: EdgeInsets.zero,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          );
        }).toList(),
      ),
    );
  }
}

class _StreamingBubble extends StatelessWidget {
  const _StreamingBubble({required this.message});

  final StreamingMessage message;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.78,
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: colorScheme.secondary,
            borderRadius: BorderRadius.circular(16),
          ),
          child: message.content.isEmpty
              ? Text(
                  '...',
                  style: TextStyle(
                    color: colorScheme.onSecondary.withAlpha(150),
                    fontSize: 20,
                  ),
                )
              : Text(
                  message.content,
                  style: TextStyle(color: colorScheme.onSecondary),
                ),
        ),
      ),
    );
  }
}
