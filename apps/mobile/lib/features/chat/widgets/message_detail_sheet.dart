import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../shared/utils/format_cost.dart';
import '../models/display_message.dart';

class MessageDetailSheet extends StatelessWidget {
  const MessageDetailSheet({super.key, required this.message});

  final SettledMessage message;

  static void show(BuildContext context, SettledMessage message) {
    showModalBottomSheet(
      context: context,
      builder: (_) => MessageDetailSheet(message: message),
    );
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final numFmt = NumberFormat('#,###');

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey[600],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Message Detail', style: textTheme.titleMedium),
          const SizedBox(height: 12),
          _row('Model', message.model ?? 'unknown'),
          if (message.tokens != null)
            _row(
              'Tokens',
              '${numFmt.format(message.tokens!.prompt)} in · '
                  '${numFmt.format(message.tokens!.completion)} out',
            ),
          if (message.cost != null) ...[
            const Divider(height: 24),
            _row('Total', formatCost(message.cost!.total)),
            _row('Input', formatCost(message.cost!.input)),
            _row('Output', formatCost(message.cost!.output)),
          ],
          if (message.receipt != null) ...[
            const Divider(height: 24),
            _row('Charged', formatCost(message.receipt!.costUsdc)),
            _row('Direct cost', formatCost(message.receipt!.equivalentDirectCost)),
            _row('Savings', '${message.receipt!.savingsPct.toStringAsFixed(0)}%'),
            if (message.receipt!.remainingBalance != null)
              _row('Balance', '\$${message.receipt!.remainingBalance!.toStringAsFixed(2)}'),
          ],
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
          Text(value),
        ],
      ),
    );
  }
}
