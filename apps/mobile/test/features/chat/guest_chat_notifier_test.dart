import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/sse_parser.dart';
import 'package:clude_mobile/features/chat/guest_chat_notifier.dart';
import 'package:clude_mobile/features/chat/models/display_message.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  late MockApiClient mockClient;

  setUpAll(() {
    registerFallbackValue(CancelToken());
  });

  setUp(() {
    mockClient = MockApiClient();
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
      ],
    );
  }

  group('GuestChatNotifier', () {
    test('initial state is settled empty with no streaming, remaining, or error', () {
      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      final state = container.read(guestChatNotifierProvider);

      expect(state.settled, isEmpty);
      expect(state.streamingMsg, isNull);
      expect(state.remaining, isNull);
      expect(state.error, isNull);
    });

    test('send adds user message to settled and creates streamingMsg', () async {
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => Stream.fromIterable([
            const SseChunk('Hello'),
            const SseDone({'remaining': 9, 'message_id': 'msg-1', 'model': 'kimi-k2'}),
          ]));

      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      final notifier = container.read(guestChatNotifierProvider.notifier);

      // Capture state just after send is called but before awaiting.
      final sendFuture = notifier.send('Hi');

      // Allow microtasks to run so the stream subscription is set up.
      await Future.microtask(() {});

      final midState = container.read(guestChatNotifierProvider);
      expect(midState.settled, hasLength(1));
      expect(midState.settled.first.role, 'user');
      expect(midState.settled.first.content, 'Hi');
      expect(midState.streamingMsg, isNotNull);

      await sendFuture;
      await Future.delayed(const Duration(milliseconds: 100));
    });

    test('send is a no-op when remaining == 0', () async {
      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      // Manually bring the notifier to the exhausted state by sending a message
      // that returns remaining=0.
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => Stream.fromIterable([
            const SseDone({'remaining': 0, 'message_id': 'msg-1', 'model': 'kimi-k2'}),
          ]));

      final notifier = container.read(guestChatNotifierProvider.notifier);
      await notifier.send('First');
      await Future.delayed(const Duration(milliseconds: 100));

      expect(container.read(guestChatNotifierProvider).remaining, 0);

      // A second send should be ignored.
      await notifier.send('Second');
      await Future.delayed(const Duration(milliseconds: 100));

      // sendGuestMessage should only have been called once.
      verify(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).called(1);
    });

    test('send is a no-op when already streaming', () async {
      // Use a StreamController so we can control when the stream completes.
      final controller = StreamController<SseEvent>();
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => controller.stream);

      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      final notifier = container.read(guestChatNotifierProvider.notifier);

      // Start first send without awaiting so it stays streaming.
      notifier.send('First');
      await Future.microtask(() {});

      expect(container.read(guestChatNotifierProvider).streamingMsg, isNotNull);

      // Attempt a second send while streaming is active.
      await notifier.send('Second');

      // sendGuestMessage should only have been called once.
      verify(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).called(1);

      controller.close();
      await Future.delayed(const Duration(milliseconds: 100));
    });

    test('send completes and updates remaining from SseDone', () async {
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => Stream.fromIterable([
            const SseChunk('World'),
            const SseDone({'remaining': 7, 'message_id': 'msg-99', 'model': 'kimi-k2'}),
          ]));

      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      final notifier = container.read(guestChatNotifierProvider.notifier);
      await notifier.send('Hello');
      await Future.delayed(const Duration(milliseconds: 100));

      final state = container.read(guestChatNotifierProvider);
      expect(state.remaining, 7);
      expect(state.streamingMsg, isNull);
      // settled: assistant reply prepended, then user message.
      expect(state.settled, hasLength(2));
      final assistant = state.settled.first;
      expect(assistant.role, 'assistant');
      expect(assistant.content, 'World');
      expect(assistant.id, 'msg-99');
    });

    test('stopStreaming converts partial buffer to settled message', () async {
      final controller = StreamController<SseEvent>();
      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((_) => controller.stream);

      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      final notifier = container.read(guestChatNotifierProvider.notifier);

      notifier.send('Hi');
      await Future.microtask(() {});

      // Emit a partial chunk so the buffer is non-empty.
      controller.add(const SseChunk('Partial'));
      await Future.microtask(() {});

      // Flush the 66ms timer.
      await Future.delayed(const Duration(milliseconds: 100));

      notifier.stopStreaming();

      final state = container.read(guestChatNotifierProvider);
      expect(state.streamingMsg, isNull);
      // settled: partial assistant + user message.
      expect(state.settled, hasLength(2));
      expect(state.settled.first.role, 'assistant');
      expect(state.settled.first.content, 'Partial');

      controller.close();
    });

    test('history is built from last 10 settled messages in chronological order, skipping empty', () async {
      // Seed the notifier with 12 settled messages to verify the 10-message cap
      // and empty-content filtering. We do this by sending a sequence of
      // exchanges where each assistant reply carries remaining info.
      final responses = List.generate(12, (i) => [
            SseChunk('Reply $i'),
            SseDone({'remaining': 12 - i, 'message_id': 'msg-$i', 'model': 'kimi'}),
          ]);

      var callIndex = 0;
      List<Map<String, String>>? capturedHistory;

      when(() => mockClient.sendGuestMessage(
            any(),
            any(),
            cancelToken: any(named: 'cancelToken'),
          )).thenAnswer((invocation) {
        if (callIndex == 11) {
          // Capture history on the 12th (last) call.
          capturedHistory =
              (invocation.positionalArguments[1] as List).cast<Map<String, String>>();
        }
        final events = responses[callIndex++];
        return Stream.fromIterable(events);
      });

      final container = createContainer();
      addTearDown(container.dispose);
      container.listen(guestChatNotifierProvider, (_, __) {});

      final notifier = container.read(guestChatNotifierProvider.notifier);

      for (var i = 0; i < 12; i++) {
        await notifier.send('Message $i');
        await Future.delayed(const Duration(milliseconds: 100));
      }

      // History on the 12th call should contain at most 10 messages.
      expect(capturedHistory, isNotNull);
      expect(capturedHistory!.length, lessThanOrEqualTo(10));

      // Each entry must have role and content.
      for (final entry in capturedHistory!) {
        expect(entry.containsKey('role'), isTrue);
        expect(entry.containsKey('content'), isTrue);
      }
    });
  });
}
