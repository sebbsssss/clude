import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/conversation.dart';
import 'package:clude_mobile/features/chat/chat_screen.dart';

class MockApiClient extends Mock implements ApiClient {}

Conversation _conv(String id, {String? title, String updatedAt = '', int messageCount = 3}) {
  return Conversation(
    id: id,
    ownerWallet: 'wallet-1',
    title: title,
    model: 'claude-3',
    messageCount: messageCount,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: updatedAt.isEmpty
        ? DateTime.now().subtract(const Duration(hours: 2)).toUtc().toIso8601String()
        : updatedAt,
  );
}

void main() {
  late MockApiClient mockClient;

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
      ],
      child: const MaterialApp(home: ConversationListScreen()),
    );
  }

  group('ConversationListScreen', () {
    testWidgets('shows loading indicator then conversation list', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1', title: 'My Chat')]);

      await tester.pumpWidget(buildSubject());

      // Loading state.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pumpAndSettle();

      // Data state.
      expect(find.text('My Chat'), findsOneWidget);
      expect(find.text('3'), findsOneWidget); // message count badge
    });

    testWidgets('shows empty state when no conversations', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No conversations yet'), findsOneWidget);
      expect(find.text('Tap + to start chatting'), findsOneWidget);
    });

    testWidgets('shows error view with retry on fetch failure', (tester) async {
      when(() => mockClient.listConversations())
          .thenThrow(Exception('Network error'));

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('displays "New conversation" for null title', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1', title: null)]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('New conversation'), findsOneWidget);
    });

    testWidgets('FAB shows add icon', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.add), findsOneWidget);
    });

    testWidgets('swipe left shows delete confirmation dialog', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1', title: 'Test Convo')]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.fling(find.byType(ListTile), const Offset(-500, 0), 1000);
      await tester.pumpAndSettle();

      expect(find.text('Delete conversation?'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
      expect(find.text('Delete'), findsOneWidget);
    });

    testWidgets('cancel on delete dialog keeps item', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1', title: 'Test Convo')]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.fling(find.byType(ListTile), const Offset(-500, 0), 1000);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(find.text('Test Convo'), findsOneWidget);
      verifyNever(() => mockClient.deleteConversation(any()));
    });

    testWidgets('confirm delete removes item from list', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1', title: 'Test Convo')]);
      when(() => mockClient.deleteConversation('1'))
          .thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.fling(find.byType(ListTile), const Offset(-500, 0), 1000);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(find.text('Test Convo'), findsNothing);
      verify(() => mockClient.deleteConversation('1')).called(1);
    });

    testWidgets('shows relative timestamp', (tester) async {
      when(() => mockClient.listConversations())
          .thenAnswer((_) async => [_conv('1', title: 'My Convo')]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // _conv sets updatedAt to 2h ago by default.
      expect(find.text('2h ago'), findsOneWidget);
    });
  });
}
