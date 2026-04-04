import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/sse_parser.dart';
import 'package:clude_mobile/features/chat/guest_chat_screen.dart';
import 'dart:async';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockClient;

  setUpAll(() {
    registerFallbackValue(CancelToken());
  });

  setUp(() {
    mockClient = MockApiClient();
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
      ],
      child: const MaterialApp(home: GuestChatScreen()),
    );
  }

  group('GuestChatScreen', () {
    testWidgets('renders "Chat" title in AppBar', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.text('Chat'), findsOneWidget);
    });

    testWidgets('shows "Guest mode — 10 free messages" banner when remaining is null', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.text('Guest mode — 10 free messages'), findsOneWidget);
    });

    testWidgets('input bar is enabled initially', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pump();

      final textField = tester.widget<TextField>(find.byType(TextField));
      expect(textField.enabled, isTrue);
    });

    testWidgets('shows "X/10 free messages remaining" banner after message is sent', (tester) async {
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => Stream.fromIterable([
            const SseChunk('Response'),
            const SseDone({'remaining': 7, 'message_id': 'msg-1', 'model': 'kimi'}),
          ]));

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();

      // Wait for the stream and 66ms flush timer to complete.
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('7/10 free messages remaining'), findsOneWidget);
    });

    testWidgets('shows exhausted banner with "Sign in for unlimited access" when remaining == 0', (tester) async {
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => Stream.fromIterable([
            const SseChunk('Last reply'),
            const SseDone({'remaining': 0, 'message_id': 'msg-1', 'model': 'kimi'}),
          ]));

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      await tester.enterText(find.byType(TextField), 'Final question');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();

      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text("You've used all 10 free messages."), findsOneWidget);
      expect(find.text('Sign in for unlimited access'), findsOneWidget);
    });

    testWidgets('input bar is disabled when remaining == 0', (tester) async {
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => Stream.fromIterable([
            const SseDone({'remaining': 0, 'message_id': 'msg-1', 'model': 'kimi'}),
          ]));

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      await tester.enterText(find.byType(TextField), 'Last');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();

      await tester.pump(const Duration(milliseconds: 100));

      final textField = tester.widget<TextField>(find.byType(TextField));
      expect(textField.enabled, isFalse);
    });

    testWidgets('stop button appears during streaming', (tester) async {
      final controller = StreamController<SseEvent>();
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => controller.stream);

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      // Stop icon should not be present before streaming starts.
      expect(find.byIcon(Icons.stop_circle_outlined), findsNothing);

      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();

      // Allow the stream subscription to be established.
      await tester.pump();

      expect(find.byIcon(Icons.stop_circle_outlined), findsOneWidget);

      controller.close();
      await tester.pump(const Duration(milliseconds: 100));
    });
  });
}
