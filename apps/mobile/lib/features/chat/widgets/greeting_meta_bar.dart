import 'package:flutter/material.dart';

import '../../../core/api/models/responses.dart';

class GreetingMetaBar extends StatelessWidget {
  const GreetingMetaBar({super.key, required this.meta});

  final GreetingMeta meta;

  String? _spanLabel() {
    final span = meta.temporalSpan;
    if (span == null) return null;
    if (span.weeks <= 1) return 'this week';
    if (span.weeks < 52) return '${span.weeks}w';
    return 'since ${span.sinceLabel}';
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final spanLabel = _spanLabel();

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        _Chip(
          label: '${meta.totalMemories} memories'
              '${spanLabel != null ? ' · $spanLabel' : ''}',
          color: colorScheme.primary,
        ),
        ...meta.topics.take(4).map((topic) => _Chip(
              label: topic,
              color: colorScheme.onSurface,
            )),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, color: color.withAlpha(180)),
      ),
    );
  }
}
