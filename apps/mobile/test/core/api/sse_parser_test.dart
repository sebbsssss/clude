import 'dart:convert';

import 'package:clude_mobile/core/api/api_exceptions.dart';
import 'package:clude_mobile/core/api/sse_parser.dart';
import 'package:flutter_test/flutter_test.dart';

Stream<List<int>> _toByteStream(List<String> chunks) async* {
  for (final chunk in chunks) {
    yield utf8.encode(chunk);
  }
}

void main() {
  group('parseSseStream', () {
    test('emits SseChunk for data.content lines', () async {
      final stream = _toByteStream([
        'data: {"content":"Hello"}\n',
        'data: {"content":" world"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(3));
      expect(events[0], isA<SseChunk>());
      expect((events[0] as SseChunk).text, 'Hello');
      expect((events[1] as SseChunk).text, ' world');
      expect(events[2], isA<SseDone>());
    });

    test('emits SseChunk for data.chunk lines', () async {
      final stream = _toByteStream([
        'data: {"chunk":"Hi"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events[0], isA<SseChunk>());
      expect((events[0] as SseChunk).text, 'Hi');
    });

    test('skips keepalive pings (colon prefix)', () async {
      final stream = _toByteStream([
        ': keepalive\n',
        'data: {"content":"text"}\n',
        ': ping\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(2));
      expect(events[0], isA<SseChunk>());
      expect(events[1], isA<SseDone>());
    });

    test('handles [DONE] sentinel', () async {
      final stream = _toByteStream([
        'data: {"content":"a"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events.last, isA<SseDone>());
      expect((events.last as SseDone).data, isNull);
    });

    test('handles data.done with metadata', () async {
      final stream = _toByteStream([
        'data: {"content":"hi"}\n',
        'data: {"done":true,"message_id":"m1","model":"gpt-4"}\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(2));
      final done = events[1] as SseDone;
      expect(done.data?['message_id'], 'm1');
      expect(done.data?['model'], 'gpt-4');
    });

    test('buffers partial lines across TCP packets', () async {
      final stream = _toByteStream([
        'data: {"con',
        'tent":"split"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events[0], isA<SseChunk>());
      expect((events[0] as SseChunk).text, 'split');
    });

    test('throws ApiException on data.error', () async {
      final stream = _toByteStream([
        'data: {"error":"something broke"}\n',
      ]);

      expect(
        () => parseSseStream(stream).toList(),
        throwsA(isA<ApiException>()),
      );
    });

    test('skips non-data lines', () async {
      final stream = _toByteStream([
        'event: message\n',
        'id: 123\n',
        'data: {"content":"ok"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(2));
    });

    test('flushes buffer on stream end', () async {
      // Stream ends without trailing newline
      final stream = _toByteStream([
        'data: {"content":"final"}',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(1));
      expect((events[0] as SseChunk).text, 'final');
    });

    test('skips malformed JSON silently', () async {
      final stream = _toByteStream([
        'data: {not json}\n',
        'data: {"content":"ok"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(2));
      expect(events[0], isA<SseChunk>());
    });

    test('handles multiple lines in single packet', () async {
      final stream = _toByteStream([
        'data: {"content":"a"}\ndata: {"content":"b"}\ndata: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(3));
      expect((events[0] as SseChunk).text, 'a');
      expect((events[1] as SseChunk).text, 'b');
      expect(events[2], isA<SseDone>());
    });

    // Vercel AI SDK v6 UI message stream protocol tests

    test('emits SseChunk for text-delta events', () async {
      final stream = _toByteStream([
        'data: {"type":"start","messageId":"msg-1"}\n',
        'data: {"type":"text-start","id":"text-1"}\n',
        'data: {"type":"text-delta","id":"text-1","delta":"Hello"}\n',
        'data: {"type":"text-delta","id":"text-1","delta":" world"}\n',
        'data: {"type":"text-end","id":"text-1"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(3)); // 2 chunks + DONE
      expect((events[0] as SseChunk).text, 'Hello');
      expect((events[1] as SseChunk).text, ' world');
      expect(events[2], isA<SseDone>());
    });

    test('emits SseDone with messageMetadata on finish', () async {
      final stream = _toByteStream([
        'data: {"type":"text-delta","id":"t1","delta":"Hi"}\n',
        'data: {"type":"finish","finishReason":"stop","messageMetadata":{"message_id":"m1","model":"gpt-4o","memory_ids":[1,2,3],"cost":{"total":0.05}}}\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(2));
      expect((events[0] as SseChunk).text, 'Hi');
      final done = events[1] as SseDone;
      expect(done.data?['message_id'], 'm1');
      expect(done.data?['model'], 'gpt-4o');
      expect(done.data?['memory_ids'], [1, 2, 3]);
    });

    test('emits SseChunk for reasoning-delta events (thinking models)', () async {
      final stream = _toByteStream([
        'data: {"type":"reasoning-delta","id":"r1","delta":"Let me think..."}\n',
        'data: {"type":"text-delta","id":"t1","delta":"The answer is 42"}\n',
        'data: [DONE]\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(3));
      expect((events[0] as SseChunk).text, 'Let me think...');
      expect((events[1] as SseChunk).text, 'The answer is 42');
    });

    test('throws ApiException on Vercel error event', () async {
      final stream = _toByteStream([
        'data: {"type":"error","errorText":"Rate limit exceeded"}\n',
      ]);

      expect(
        () => parseSseStream(stream).toList(),
        throwsA(isA<ApiException>()),
      );
    });

    test('skips non-content Vercel events (start, text-start, text-end)', () async {
      final stream = _toByteStream([
        'data: {"type":"start","messageId":"msg-1"}\n',
        'data: {"type":"start-step"}\n',
        'data: {"type":"text-start","id":"t1"}\n',
        'data: {"type":"text-delta","id":"t1","delta":"ok"}\n',
        'data: {"type":"text-end","id":"t1"}\n',
        'data: {"type":"finish-step"}\n',
        'data: {"type":"finish","finishReason":"stop"}\n',
      ]);

      final events = await parseSseStream(stream).toList();
      expect(events, hasLength(2)); // 1 chunk + finish done
      expect((events[0] as SseChunk).text, 'ok');
      expect(events[1], isA<SseDone>());
    });
  });
}
