import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/features/chat/chat_screen.dart';

void main() {
  group('ActiveChatScreen lifecycle', () {
    Widget buildSubject({String conversationId = 'test-123'}) {
      return ProviderScope(
        child: MaterialApp(
          home: ActiveChatScreen(conversationId: conversationId),
        ),
      );
    }

    testWidgets('is a ConsumerStatefulWidget', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.text('Chat test-123'), findsOneWidget);

      final element = tester.element(find.byType(ActiveChatScreen));
      expect(element.widget, isA<ConsumerStatefulWidget>());
    });

    testWidgets('renders normally with conversation id', (tester) async {
      await tester.pumpWidget(buildSubject(conversationId: 'conv-456'));

      expect(find.text('Chat conv-456'), findsOneWidget);
    });

    testWidgets('handles pause lifecycle without error', (tester) async {
      await tester.pumpWidget(buildSubject());

      // Simulate app going to background — should not throw
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();

      expect(find.text('Chat test-123'), findsOneWidget);
    });

    testWidgets('handles resume lifecycle without error', (tester) async {
      await tester.pumpWidget(buildSubject());

      // Simulate background then foreground
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(find.text('Chat test-123'), findsOneWidget);
    });
  });
}
