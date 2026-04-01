import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/shared/widgets/empty_state_widget.dart';

void main() {
  group('EmptyStateWidget', () {
    testWidgets('renders icon and title', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateWidget(title: 'No items yet'),
          ),
        ),
      );

      expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);
      expect(find.text('No items yet'), findsOneWidget);
    });

    testWidgets('renders custom icon', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateWidget(
              title: 'Empty',
              icon: Icons.chat_bubble_outline,
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.chat_bubble_outline), findsOneWidget);
    });

    testWidgets('renders subtitle when provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateWidget(
              title: 'No messages',
              subtitle: 'Start a conversation',
            ),
          ),
        ),
      );

      expect(find.text('No messages'), findsOneWidget);
      expect(find.text('Start a conversation'), findsOneWidget);
    });

    testWidgets('does not render subtitle when null', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateWidget(title: 'Empty'),
          ),
        ),
      );

      expect(find.text('Start a conversation'), findsNothing);
    });
  });
}
