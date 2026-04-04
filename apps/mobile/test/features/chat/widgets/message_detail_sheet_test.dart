import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:clude_mobile/core/api/models/responses.dart';
import 'package:clude_mobile/features/chat/models/display_message.dart';
import 'package:clude_mobile/features/chat/widgets/message_detail_sheet.dart';

void main() {
  Widget buildSubject(SettledMessage message) {
    return MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => MessageDetailSheet.show(context, message),
            child: const Text('Open'),
          ),
        ),
      ),
    );
  }

  group('MessageDetailSheet', () {
    testWidgets('shows model and formatted tokens', (tester) async {
      final msg = SettledMessage(
        id: '1',
        role: 'assistant',
        content: 'Hello',
        model: 'claude-sonnet-4-20250514',
        tokens: const MessageTokens(prompt: 1234, completion: 567),
      );
      await tester.pumpWidget(buildSubject(msg));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('claude-sonnet-4-20250514'), findsOneWidget);
      expect(find.text('1,234 in · 567 out'), findsOneWidget);
    });

    testWidgets('shows Free when cost total is zero', (tester) async {
      final msg = SettledMessage(
        id: '2',
        role: 'assistant',
        content: 'Hi',
        cost: const MessageCost(total: 0),
      );
      await tester.pumpWidget(buildSubject(msg));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Free'), findsWidgets);
    });

    testWidgets('shows cost input and output rows', (tester) async {
      final msg = SettledMessage(
        id: '3',
        role: 'assistant',
        content: 'Hi',
        cost: const MessageCost(total: 0.05, input: 0.03, output: 0.02),
      );
      await tester.pumpWidget(buildSubject(msg));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('\$0.0500'), findsOneWidget); // total
      expect(find.text('\$0.0300'), findsOneWidget); // input
      expect(find.text('\$0.0200'), findsOneWidget); // output
    });

    testWidgets('shows receipt with savings', (tester) async {
      final msg = SettledMessage(
        id: '4',
        role: 'assistant',
        content: 'Hi',
        receipt: const MessageReceipt(
          costUsdc: 0.05,
          equivalentDirectCost: 0.08,
          savingsPct: 37.5,
          remainingBalance: 10.0,
        ),
      );
      await tester.pumpWidget(buildSubject(msg));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('38%'), findsOneWidget);
      expect(find.text('\$10.00'), findsOneWidget);
    });

    testWidgets('hides balance row when null', (tester) async {
      final msg = SettledMessage(
        id: '5',
        role: 'assistant',
        content: 'Hi',
        receipt: const MessageReceipt(
          costUsdc: 0.05,
          equivalentDirectCost: 0.08,
          savingsPct: 37.5,
        ),
      );
      await tester.pumpWidget(buildSubject(msg));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Balance'), findsNothing);
    });

    testWidgets('hides cost and receipt when absent', (tester) async {
      final msg = SettledMessage(
        id: '6',
        role: 'assistant',
        content: 'Hi',
        model: 'claude-sonnet-4-20250514',
      );
      await tester.pumpWidget(buildSubject(msg));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Total'), findsNothing);
      expect(find.text('Charged'), findsNothing);
      expect(find.text('claude-sonnet-4-20250514'), findsOneWidget);
    });
  });
}
